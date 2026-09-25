import { NextResponse } from "next/server";
import { createReportingClient } from "@/lib/analytics/reporting-refresh";

import { shopifyGraph } from "@/lib/shopify/graphql";
import { requireWorkspace } from "@/lib/workspace/server";

type Row = Record<string, string | number | null>;
type Payload = { shopifyqlQuery: { tableData: { rows: Row[] } | null; parseErrors: string[] } };
const graphQuery = `query OverviewWidgets($shopifyQl: String!) {
  shopifyqlQuery(query: $shopifyQl) { tableData { rows } parseErrors }
}`;
const number = (value: unknown) => {
  const parsed = Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "2000-01-01";
  const to = params.get("to") || new Date().toISOString().slice(0, 10);
  if (!validDate(from) || !validDate(to) || from > to) {
    return NextResponse.json({ error: "Select a valid reporting period" }, { status: 400 });
  }
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store } = workspace;
  if (!store?.shopify_domain) return NextResponse.json({ error: "Connect Shopify to load these reports" }, { status: 409 });
  const { data: token, error: secretError } = await createReportingClient().rpc("read_connection_secret_for_server", {
    requested_store_id: store.id,
    connection_provider: "shopify",
  });
  if (secretError || typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Reconnect Shopify to load these reports" }, { status: 409 });
  }
  const range = `SINCE ${from} UNTIL ${to}`;
  const run = async (query: string) => {
    const result = await shopifyGraph<Payload>(store.shopify_domain!, token, graphQuery, { shopifyQl: query });
    if (result.shopifyqlQuery.parseErrors?.length) throw new Error(result.shopifyqlQuery.parseErrors.join("; "));
    return result.shopifyqlQuery.tableData?.rows ?? [];
  };
  try {
    const [channels, products, customers] = await Promise.all([
      run(`FROM sales SHOW total_sales, orders GROUP BY order_referrer_source ${range} ORDER BY total_sales DESC LIMIT 20`),
      run(`FROM sales SHOW net_sales, net_items_sold GROUP BY product_title ${range} ORDER BY net_sales DESC LIMIT 5`),
      run(`FROM sales SHOW total_sales, orders GROUP BY new_or_returning_customer ${range} ORDER BY total_sales DESC LIMIT 10`),
    ]);
    return NextResponse.json({
      currency: store.currency,
      from,
      to,
      channels: channels.map((row) => ({
        channel: String(row.order_referrer_source ?? "Unknown") || "Unknown",
        sales: number(row.total_sales),
        orders: number(row.orders),
      })),
      products: products.map((row, index) => ({
        key: `${index}-${String(row.product_title ?? "")}`,
        product: String(row.product_title ?? "Unknown product"),
        variant: "",
        units: number(row.net_items_sold),
        netRevenue: number(row.net_sales),
      })),
      customers: customers.map((row) => ({
        label: String(row.new_or_returning_customer ?? "Other") || "Other",
        sales: number(row.total_sales),
        orders: number(row.orders),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify reports could not be loaded" }, { status: 502 });
  }
}
