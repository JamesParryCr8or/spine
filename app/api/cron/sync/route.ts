import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rollingSyncWindow, runReportingSyncForStore } from "@/lib/analytics/reporting-sync";
import { isDailySyncDue } from "@/lib/analytics/sync-schedule";

export const maxDuration = 300;

type Store = { id: string; organization_id: string; shopify_domain: string | null; currency: string; business_model: string | null; timezone: string | null };

/**
 * Scheduled reporting refresh (see vercel.json "crons"). Each store refreshes
 * once a day at the hour set in Settings (store_sync_schedule, store
 * timezone; default 06:00), so most ticks do nothing. A store whose Shopify
 * import paused at its time limit is also picked up, to finish it. Keeps the P&L and
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

  // Leave headroom under maxDuration (300s) for the in-flight order page and
  // the final run updates; each store's Shopify import gets at most 120s of it.
  const overallDeadline = Date.now() + 240_000;
  const supabase = createAdminClient();
  const { data: storeRows, error: storesError } = await supabase.from("stores").select("id,organization_id,shopify_domain,currency,business_model,timezone");
  if (storesError) return NextResponse.json({ error: storesError.message }, { status: 500 });
  const [{ data: scheduleRows }, { data: recentRuns }, { data: pausedRows }] = await Promise.all([
    supabase.from("store_sync_schedule").select("store_id,enabled,sync_hour"),
    supabase.from("reporting_sync_runs").select("store_id,created_at").eq("trigger", "cron").gte("created_at", new Date(Date.now() - 48 * 3600_000).toISOString()).order("created_at", { ascending: false }),
    supabase.from("sync_runs").select("store_id").eq("source", "shopify").eq("status", "paused"),
  ]);
  const schedules = new Map((scheduleRows ?? []).map((row) => [row.store_id as string, row as { enabled: boolean; sync_hour: number }]));
  const lastRun = new Map<string, string>();
  for (const run of recentRuns ?? []) if (!lastRun.has(run.store_id as string)) lastRun.set(run.store_id as string, run.created_at as string);
  const paused = new Set((pausedRows ?? []).map((row) => row.store_id as string));
  const now = new Date();

  const { from, to } = rollingSyncWindow();
  const outcomes = [];
  for (const store of (storeRows ?? []) as Store[]) {
    const due = isDailySyncDue({ now, timeZone: store.timezone ?? "UTC", schedule: schedules.get(store.id), lastScheduledRunAt: lastRun.get(store.id) ?? null });
    if (!due && !paused.has(store.id)) continue;
    // Past the overall budget, stores still get the reporting refresh; their
    // order import waits for the next tick.
    const importDeadline = Date.now() < overallDeadline ? Math.min(overallDeadline, Date.now() + 120_000) : undefined;
    outcomes.push(await runReportingSyncForStore(supabase, store, from, to, "cron", importDeadline));
  }

  const failed = outcomes.filter((outcome) => outcome.status === "failed");
  return NextResponse.json({ window: { from, to }, outcomes }, { status: failed.length ? 207 : 200 });
}
