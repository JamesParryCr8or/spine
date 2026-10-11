import { NextResponse } from "next/server";

import { buildSalesInsights, salesInsightQueries } from "@/lib/analytics/sales-insights";
import { runStoreShopifyQl } from "@/lib/shopify/shopifyql";
import { requireWorkspace } from "@/lib/workspace/server";

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

  const outcome = await runStoreShopifyQl(store, salesInsightQueries(from, to));
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  const insights = buildSalesInsights(outcome.results);

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
