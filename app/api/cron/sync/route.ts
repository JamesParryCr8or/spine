import { NextResponse } from "next/server";

import { createReportingClient } from "@/lib/analytics/reporting-refresh";
import { rollingSyncWindow, runReportingSyncForStore } from "@/lib/analytics/reporting-sync";

export const maxDuration = 300;

type Store = { id: string; organization_id: string; shopify_domain: string | null; currency: string };

/**
 * Scheduled reporting refresh (see vercel.json "crons"). Keeps the P&L and
 * Overview read models (ShopifyQL daily sales/fees, Meta, Google Ads,
 * Microsoft Ads) warm in the background so a page load never waits on a
 * live Shopify/Meta/Google/Microsoft round trip - see
 * TODO-AUDIT.md Phase 1. Runs stores one at a time rather than in parallel:
 * refreshReportingData() already fans each store's five sources out
 * concurrently, and running many stores at once would multiply API-rate-
 * limit pressure on Shopify/Meta/Google/Microsoft for no benefit within a
 * single invocation's time budget.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== "Bearer " + cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createReportingClient();
  const { data: storeRows, error: storesError } = await supabase.from("stores").select("id,organization_id,shopify_domain,currency");
  if (storesError) return NextResponse.json({ error: storesError.message }, { status: 500 });

  const { from, to } = rollingSyncWindow();
  const outcomes = [];
  for (const store of (storeRows ?? []) as Store[]) {
    outcomes.push(await runReportingSyncForStore(supabase, store, from, to, "cron"));
  }

  const failed = outcomes.filter((outcome) => outcome.status === "failed");
  return NextResponse.json({ window: { from, to }, outcomes }, { status: failed.length ? 207 : 200 });
}
