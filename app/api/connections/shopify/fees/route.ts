import { NextResponse } from "next/server";
import { createReportingClient } from "@/lib/analytics/reporting-refresh";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";
import { shopifyGraph } from "@/lib/shopify/graphql";
import { requireWorkspace } from "@/lib/workspace/server";

export const maxDuration = 300;

type FeeRow = Record<string, string | number | null>;
type FeeReport = { shopifyqlQuery: { tableData: { rows: FeeRow[] } | null; parseErrors: string[] } };
type BalanceTransaction = { id: string; transactionDate: string; test: boolean; fee: { amount: string; currencyCode: string }; associatedOrder: { id: string } | null };
type BalanceReport = { shopifyPaymentsAccount: { balanceTransactions: { nodes: BalanceTransaction[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null };

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const money = (value: unknown) => {
  const amount = Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};
const localDate = (value: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export async function POST(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, membership, store } = workspace;
  if (!store?.shopify_domain) return NextResponse.json({ error: "Connect Shopify first." }, { status: 409 });
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { from?: string; to?: string } | null;
  const from = body?.from ?? "";
  const to = body?.to ?? "";
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) {
    return NextResponse.json({ error: "Choose a valid fee import window of up to 366 days." }, { status: 400 });
  }
  const { data: token, error: secretError } = await createReportingClient().rpc("read_connection_secret_for_server", {
    requested_store_id: store.id, connection_provider: "shopify",
  });
  if (secretError || typeof token !== "string" || !token) return NextResponse.json({ error: "Reconnect Shopify to refresh payment fees." }, { status: 409 });

  try {
    const feeReport = await shopifyGraph<FeeReport>(store.shopify_domain, token,
      `query DailyFees($shopifyQl: String!) { shopifyqlQuery(query: $shopifyQl) { tableData { rows } parseErrors } }`,
      { shopifyQl: `FROM fees SHOW shopify_payments_processing_fees, foreign_exchange_fees, managed_markets_fees, international_fees TIMESERIES day SINCE ${from} UNTIL ${to} ORDER BY day ASC` });
    const parseError = feeReport.shopifyqlQuery.parseErrors?.[0];
    if (parseError) throw new Error(`Shopify fee report: ${parseError}`);
    const reported = new Map<string, { processing: number; foreignExchange: number; managedMarkets: number; international: number }>();
    for (const row of feeReport.shopifyqlQuery.tableData?.rows ?? []) {
      const day = String(row.day ?? "").slice(0, 10);
      if (!validDate(day) || day < from || day > to) continue;
      const processing = money(row.shopify_payments_processing_fees);
      const foreignExchange = money(row.foreign_exchange_fees);
      const managedMarkets = money(row.managed_markets_fees);
      const international = money(row.international_fees);
      if (processing || foreignExchange || managedMarkets || international) reported.set(day, { processing, foreignExchange, managedMarkets, international });
    }

    const balance = new Map<string, number>();
    let balanceWarning = "";
    if (reported.size === 0) {
    try {
      const { data: rates, error: ratesError } = await supabase.from("exchange_rates")
        .select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id)
        .eq("quote_currency", store.currency).order("effective_date", { ascending: true });
      if (ratesError) throw new Error("Currency rates could not be loaded");
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const result: BalanceReport = await shopifyGraph<BalanceReport>(store.shopify_domain, token,
          `query FeeTransactions($cursor: String, $search: String!) { shopifyPaymentsAccount { balanceTransactions(first: 100, after: $cursor, query: $search, sortKey: PROCESSED_AT, reverse: true, hideTransfers: true) { nodes { id fee { amount currencyCode } transactionDate test associatedOrder { id } type } pageInfo { hasNextPage endCursor } } } }`,
          { cursor, search: `processed_at:>=${from} processed_at:<${new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10)}` });
        const connection = result.shopifyPaymentsAccount?.balanceTransactions;
        if (!connection) break;
        for (const transaction of connection.nodes) {
          if (transaction.test || !transaction.associatedOrder) continue;
          const day = localDate(transaction.transactionDate, store.timezone || "UTC");
          if (day < from || day > to || reported.has(day)) continue;
          const rate = resolveDatedExchangeRate((rates ?? []) as DatedExchangeRate[], transaction.fee.currencyCode, store.currency, transaction.transactionDate);
          if (rate === null) { balanceWarning = "Some payout fees have no currency conversion rate."; continue; }
          const fee = convertDatedAmount(money(transaction.fee.amount), rate, store.currency);
          balance.set(day, (balance.get(day) ?? 0) + fee);
        }
        if (!connection.pageInfo.hasNextPage) break;
        if (!connection.pageInfo.endCursor || page === 99) throw new Error("Shopify returned more payout transactions than this refresh can safely import.");
        cursor = connection.pageInfo.endCursor;
      }
    } catch {
      balanceWarning = "Shopify payout transactions were unavailable; ShopifyQL fee totals were still checked.";
    }
    }

    const { data: existing, error: dailyError } = await supabase.from("shopify_sales_daily").select("*")
      .eq("store_id", store.id).gte("sales_date", from).lte("sales_date", to);
    if (dailyError) throw new Error(dailyError.message);
    const updates = (existing ?? []).flatMap((row) => {
      const reportedDay = reported.get(row.sales_date);
      const balanceFee = balance.get(row.sales_date);
      if (!reportedDay && balanceFee === undefined) return [];
      const processing = reportedDay?.processing ?? balanceFee ?? 0;
      const foreignExchange = reportedDay?.foreignExchange ?? 0;
      const managedMarkets = reportedDay?.managedMarkets ?? 0;
      const international = reportedDay?.international ?? 0;
      return [{ ...row, shopify_payments_processing_fees: processing, foreign_exchange_fees: foreignExchange,
        managed_markets_fees: managedMarkets, international_fees: international,
        total_payment_fees: processing + international, synced_at: new Date().toISOString() }];
    });
    if (updates.length) {
      const { error } = await supabase.from("shopify_sales_daily").upsert(updates, { onConflict: "store_id,sales_date" });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ importedDays: updates.length, shopifyQlDays: reported.size, payoutDays: balance.size,
      warning: balanceWarning || (updates.length ? "" : "Shopify returned no payment fee records for this period. Check Shopify Payments or add a gateway fee rule.") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify fees could not be refreshed." }, { status: 502 });
  }
}
