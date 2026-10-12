import { NextResponse } from "next/server";

import { buildProductPerformance, productQueries } from "@/lib/analytics/product-performance";
import { runStoreShopifyQl } from "@/lib/shopify/shopifyql";
import { timed } from "@/lib/server-timing";
import { requireWorkspace } from "@/lib/workspace/server";

const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** First day of the month 11 months before `to`'s month, but never earlier than `from`'s month. */
function trendStart(from: string, to: string) {
  const end = new Date(`${to}T00:00:00Z`);
  const back = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  const fromMonth = `${from.slice(0, 7)}-01`;
  return back > fromMonth ? back : fromMonth;
}

async function handleGet(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const outcome = await runStoreShopifyQl(store, productQueries(from, to, trendStart(from, to)));
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ currency: store.currency, timezone: store.timezone || "UTC", period: { from, to }, ...buildProductPerformance(outcome.results) });
}

export const GET = timed("analytics/product-performance", handleGet);
