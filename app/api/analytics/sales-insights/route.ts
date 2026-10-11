import { NextResponse } from "next/server";

import { buildSalesInsights, salesInsightQueries, salesInsightQueryNames, type SalesInsightResults } from "@/lib/analytics/sales-insights";
import type { ShopifyQlRow } from "@/lib/analytics/campaign-rows";
import { shopifyGraph } from "@/lib/shopify/graphql";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/workspace/server";

type ShopifyQlResult = { shopifyqlQuery: { tableData: { rows: ShopifyQlRow[] } | null; parseErrors: string[] } };
const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!store.shopify_domain) return NextResponse.json({ error: "Connect Shopify to see sales insights" }, { status: 404 });

  // The token is read with the service role only after membership is confirmed above (same as the report refresh).
  const { data: token, error: tokenError } = await createAdminClient().rpc("read_connection_secret_for_server", { requested_store_id: store.id, connection_provider: "shopify" });
  if (tokenError || typeof token !== "string" || !token) return NextResponse.json({ error: "Shopify is not connected for this store" }, { status: 404 });

  const queries = salesInsightQueries(from, to);
  let entries: Array<readonly [string, ShopifyQlRow[]]>;
  try {
    entries = await Promise.all(salesInsightQueryNames.map(async (name) => {
      const result = await shopifyGraph<ShopifyQlResult>(
        store.shopify_domain!, token,
        `query SalesInsight($shopifyQl:String!){ shopifyqlQuery(query:$shopifyQl){ tableData{ rows } parseErrors } }`,
        { shopifyQl: queries[name] },
      );
      const parseError = result.shopifyqlQuery.parseErrors[0];
      if (parseError) throw new Error(`Shopify sales query (${name}): ${parseError}`);
      return [name, result.shopifyqlQuery.tableData?.rows ?? []] as const;
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify could not run the sales query" }, { status: 502 });
  }
  const insights = buildSalesInsights(Object.fromEntries(entries) as SalesInsightResults);

  // An empty period usually means the dates miss the data: say where the store's sales actually are.
  let dataRange: { from: string; to: string } | null = null;
  if (insights.summary.orders === 0) {
    const base = () => supabase.from("shopify_sales_daily").select("sales_date").eq("store_id", store.id).gt("orders", 0);
    const [first, last] = await Promise.all([base().order("sales_date", { ascending: true }).limit(1), base().order("sales_date", { ascending: false }).limit(1)]);
    const firstDay = first.data?.[0]?.sales_date, lastDay = last.data?.[0]?.sales_date;
    if (firstDay && lastDay) dataRange = { from: firstDay, to: lastDay };
  }
  return NextResponse.json({ hasData: insights.summary.orders > 0, currency: store.currency, timezone: store.timezone || "UTC", dataRange, ...insights });
}
