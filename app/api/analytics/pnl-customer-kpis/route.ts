import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { reportingPeriods, type ReportingGranularity } from "@/lib/analytics/reporting-periods";
import { reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";

type Order = {
  id: string;
  customer_id: string | null;
  processed_at: string;
  net_product_sales: string;
  shipping_revenue: string;
  currency: string;
};
type PeriodRow = {
  start: string;
  end: string;
  label: string;
  newCustomers: number;
  newOrders: number;
  newSales: number;
  repeatCustomers: number;
  repeatOrders: number;
  repeatSales: number;
  guestOrders: number;
  guestSales: number;
  excludedCurrencyOrders: number;
};

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const granularity = params.get("granularity") as ReportingGranularity;
  if (!validDate(from) || !validDate(to) || from > to || !["daily", "weekly", "monthly", "quarterly", "annual"].includes(granularity)) {
    return NextResponse.json({ error: "Choose a valid date range and grouping" }, { status: 400 });
  }
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const timezone = store.timezone || "UTC";
  const periods = reportingPeriods(from, to, granularity, 12);
  const rows: PeriodRow[] = periods.map((period) => ({
    ...period, newCustomers: 0, newOrders: 0, newSales: 0, repeatCustomers: 0,
    repeatOrders: 0, repeatSales: 0, guestOrders: 0, guestSales: 0, excludedCurrencyOrders: 0,
  }));
  const bounds = periods.map((period) => reportingRangeToUtc(period.start, period.end, timezone));
  const endExclusive = reportingRangeToUtc(to, to, timezone).endExclusive;
  const { data: rateRows, error: rateError } = await supabase.from("exchange_rates")
    .select("base_currency,quote_currency,rate,effective_date")
    .eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true });
  if (rateError) return NextResponse.json({ error: rateError.message }, { status: 500 });
  const rates = (rateRows ?? []) as DatedExchangeRate[];
  const seen = new Set<string>();
  const newCustomerSets = rows.map(() => new Set<string>());
  const repeatCustomerSets = rows.map(() => new Set<string>());
  const selectedOrders = new Map<string, { periodIndex: number; kind: "new" | "repeat" | "guest"; exchangeRate: number }>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("shopify_orders")
      .select("id,customer_id,processed_at,net_product_sales,shipping_revenue,currency")
      .eq("store_id", store.id).eq("test", false).is("cancelled_at", null)
      .not("processed_at", "is", null).lt("processed_at", endExclusive)
      .order("processed_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Order[];
    for (const order of page) {
      const kind = !order.customer_id ? "guest" : seen.has(order.customer_id) ? "repeat" : "new";
      if (order.customer_id) seen.add(order.customer_id);
      const index = bounds.findIndex((bound) => order.processed_at >= bound.start && order.processed_at < bound.endExclusive);
      if (index < 0) continue;
      const row = rows[index];
      const exchangeRate = resolveDatedExchangeRate(rates, order.currency, store.currency, order.processed_at);
      if (exchangeRate === null) { row.excludedCurrencyOrders += 1; continue; }
      const sales = convertDatedAmount(Number(order.net_product_sales ?? 0) + Number(order.shipping_revenue ?? 0), exchangeRate, store.currency);
      if (kind === "new") {
        row.newOrders += 1; row.newSales += sales; newCustomerSets[index].add(order.customer_id!);
      } else if (kind === "repeat") {
        row.repeatOrders += 1; row.repeatSales += sales; repeatCustomerSets[index].add(order.customer_id!);
      } else {
        row.guestOrders += 1; row.guestSales += sales;
      }
      selectedOrders.set(order.id, { periodIndex: index, kind, exchangeRate });
    }
    if (page.length < pageSize) break;
  }
  const ids = [...selectedOrders.keys()];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data, error } = await supabase.from("shopify_refunds").select("order_id,total_refunded")
      .in("order_id", ids.slice(offset, offset + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const refund of data ?? []) {
      const order = selectedOrders.get(refund.order_id);
      if (!order) continue;
      const amount = convertDatedAmount(Number(refund.total_refunded ?? 0), order.exchangeRate, store.currency);
      const row = rows[order.periodIndex];
      if (order.kind === "new") row.newSales -= amount;
      else if (order.kind === "repeat") row.repeatSales -= amount;
      else row.guestSales -= amount;
    }
  }
  rows.forEach((row, index) => {
    row.newCustomers = newCustomerSets[index].size;
    row.repeatCustomers = repeatCustomerSets[index].size;
  });
  return NextResponse.json({ currency: store.currency, periods: rows, definition: "First valid imported order for an identified customer is new; later orders are repeat. Guest orders are tracked separately." });
}
