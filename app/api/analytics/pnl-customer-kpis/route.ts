import { NextResponse } from "next/server";

import { reportingPeriods, type ReportingGranularity } from "@/lib/analytics/reporting-periods";
import { createReportingClient } from "@/lib/analytics/reporting-refresh";
import { shopifyGraph } from "@/lib/shopify/graphql";
import { requireWorkspace } from "@/lib/workspace/server";

export const maxDuration = 120;

type ShopifyRow = Record<string, string | number | null>;
type ShopifyQlPayload = {
  shopifyqlQuery: {
    tableData: { rows: ShopifyRow[] } | null;
    parseErrors: string[];
  };
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
const number = (value: unknown) => {
  const parsed = Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

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
  const { store } = workspace;
  if (!store?.shopify_domain) return NextResponse.json({ error: "Connect Shopify to load customer KPIs." }, { status: 409 });
  const { data: token, error: secretError } = await createReportingClient().rpc("read_connection_secret_for_server", {
    requested_store_id: store.id,
    connection_provider: "shopify",
  });
  if (secretError || typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Reconnect Shopify to load customer KPIs." }, { status: 409 });
  }

  const periods = reportingPeriods(from, to, granularity, 12);
  const graphQuery = `query PnlCustomerKpis($shopifyQl: String!) {
    shopifyqlQuery(query: $shopifyQl) { tableData { rows } parseErrors }
  }`;
  try {
    const rows: PeriodRow[] = periods.map((period) => ({
      ...period, newCustomers: 0, newOrders: 0, newSales: 0,
      repeatCustomers: 0, repeatOrders: 0, repeatSales: 0,
      guestOrders: 0, guestSales: 0, excludedCurrencyOrders: 0,
    }));
    if (!rows.length) return NextResponse.json({ currency: store.reporting_currency || store.currency, periods: rows });
    const unit = granularity === "weekly" ? "day" :
      granularity === "daily" ? "day" :
      granularity === "monthly" ? "month" :
      granularity === "quarterly" ? "quarter" : "year";
    const shopifyQl = `FROM sales SHOW new_customers, returning_customers, orders, total_sales GROUP BY new_or_returning_customer TIMESERIES ${unit} SINCE ${periods[0].start} UNTIL ${periods[periods.length - 1].end} ORDER BY ${unit} ASC LIMIT 1000`;
    const result = await shopifyGraph<ShopifyQlPayload>(store.shopify_domain, token, graphQuery, { shopifyQl });
    if (result.shopifyqlQuery.parseErrors?.length) {
      throw new Error(result.shopifyqlQuery.parseErrors.join("; "));
    }
    const periodKey = (date: string) => {
      if (granularity === "monthly") return date.slice(0, 7);
      if (granularity === "quarterly") return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
      if (granularity === "annual") return date.slice(0, 4);
      return date;
    };
    const periodByKey = new Map(granularity === "daily" || granularity === "weekly" ? [] :
      rows.map((row) => [periodKey(row.start), row] as const));
    for (const item of result.shopifyqlQuery.tableData?.rows ?? []) {
      const date = String(item[unit] ?? "").slice(0, 10);
      if (!validDate(date)) continue;
      const row = granularity === "daily" || granularity === "weekly"
        ? rows.find((period) => date >= period.start && date <= period.end)
        : periodByKey.get(periodKey(date));
      if (!row) continue;
      const kind = String(item.new_or_returning_customer ?? "").trim().toLowerCase();
      if (kind === "new") {
        row.newCustomers += number(item.new_customers);
        row.newOrders += number(item.orders);
        row.newSales += number(item.total_sales);
      } else if (kind === "returning" || kind === "repeat") {
        row.repeatCustomers += number(item.returning_customers);
        row.repeatOrders += number(item.orders);
        row.repeatSales += number(item.total_sales);
      } else {
        row.guestOrders += number(item.orders);
        row.guestSales += number(item.total_sales);
      }
    }
    return NextResponse.json({
      currency: store.reporting_currency || store.currency,
      periods: rows,
      definition: granularity === "weekly" ? "ShopifyQL daily customer groups are summed into custom seven-day periods; a returning customer active on multiple days can appear more than once." : "ShopifyQL classifies customers as new or returning in each reporting period. Guest sales are shown separately.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify customer KPIs could not be loaded." }, { status: 502 });
  }
}
