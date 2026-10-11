import { NextResponse } from "next/server";

import { buildLeakage, leakageQueries, type PostageDefaults } from "@/lib/analytics/leakage";
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

  const [outcome, defaultsResult] = await Promise.all([
    runStoreShopifyQl(store, leakageQueries(from, to)),
    supabase.from("store_cost_defaults").select("fulfilment_amount,fulfilment_basis,postage_amount,postage_basis,currency").eq("store_id", store.id).maybeSingle(),
  ]);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  if (defaultsResult.error) return NextResponse.json({ error: defaultsResult.error.message }, { status: 500 });

  // The estimate is only valid when the default rates are in the store's currency and at least one is set.
  const row = defaultsResult.data;
  const postageAmount = Number(row?.postage_amount ?? 0), fulfilmentAmount = Number(row?.fulfilment_amount ?? 0);
  const defaults: PostageDefaults | null = row && row.currency === store.currency && (postageAmount > 0 || fulfilmentAmount > 0)
    ? { postageAmount, postageBasis: row.postage_basis === "units" ? "units" : "orders", fulfilmentAmount, fulfilmentBasis: row.fulfilment_basis === "units" ? "units" : "orders" }
    : null;

  return NextResponse.json({ currency: store.currency, timezone: store.timezone || "UTC", ...buildLeakage(outcome.results, defaults) });
}
