import type { SupabaseClient } from "@supabase/supabase-js";

import { refreshReportingData, type ReportingSourceResult } from "./reporting-refresh";
import { syncGoHighLevelOpportunities } from "./gohighlevel-sync";

export { rollingSyncWindow } from "./reporting-sync-window";

type Store = { id: string; organization_id: string; shopify_domain?: string | null; currency: string; business_model?: string | null };

/** Lead-generation stores also refresh GoHighLevel; a store with no GHL set up is left out of the results. */
async function goHighLevelResult(reportingClient: SupabaseClient, store: Store): Promise<ReportingSourceResult[]> {
  if (store.business_model !== "lead_generation") return [];
  try {
    const result = await syncGoHighLevelOpportunities(reportingClient, reportingClient, store);
    if (result.ok) return [{ source: "gohighlevel", status: "fulfilled" }];
    if (result.notConfigured) return [];
    return [{ source: "gohighlevel", status: "rejected", message: result.error }];
  } catch (error) {
    return [{ source: "gohighlevel", status: "rejected", message: error instanceof Error ? error.message : "Unknown error" }];
  }
}

export type ReportingSyncOutcome =
  | { storeId: string; status: "completed"; results: ReportingSourceResult[] }
  | { storeId: string; status: "skipped" }
  | { storeId: string; status: "failed"; error: string };

/**
 * Refreshes the reporting read models (ShopifyQL daily sales/fees, Meta,
 * Google Ads, Microsoft Ads) for one store over [from, to] and records the
 * attempt in reporting_sync_runs. If a refresh for this store is already
 * running - from an overlapping cron tick or a concurrent "Sync now" click -
 * the insert hits reporting_sync_runs_one_active_idx and this returns
 * "skipped" instead of running a second refresh in parallel.
 *
 * refreshReportingData() does not throw: each of its five sources is
 * independently best-effort (Promise.allSettled), so a source that fails
 * here is retried automatically on the next run that overlaps its window.
 * The per-source outcomes are still recorded in `results` for the
 * freshness UI and for diagnosing a store whose data keeps going stale.
 *
 * `reportingClient` must be a service-role client (see
 * createReportingClient() in reporting-refresh.ts) - this writes to
 * reporting_sync_runs and refreshes data across every store, which a
 * request-scoped, RLS-bound user client cannot do.
 */
export async function runReportingSyncForStore(
  reportingClient: SupabaseClient,
  store: Store,
  from: string,
  to: string,
  trigger: "cron" | "manual",
): Promise<ReportingSyncOutcome> {
  const { data: run, error: insertError } = await reportingClient
    .from("reporting_sync_runs")
    .insert({ organization_id: store.organization_id, store_id: store.id, trigger, window_start: from, window_end: to })
    .select("id")
    .single();
  if (insertError) {
    // 23505 = unique_violation on reporting_sync_runs_one_active_idx: a refresh for this store is already running.
    if (insertError.code === "23505") return { storeId: store.id, status: "skipped" };
    return { storeId: store.id, status: "failed", error: insertError.message };
  }
  try {
    const [reportingResults, ghlResults] = await Promise.all([
      refreshReportingData(reportingClient, store, from, to),
      goHighLevelResult(reportingClient, store),
    ]);
    const results = [...reportingResults, ...ghlResults];
    await reportingClient.from("reporting_sync_runs").update({ status: "completed", results, completed_at: new Date().toISOString() }).eq("id", run.id);
    return { storeId: store.id, status: "completed", results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reporting sync failed";
    await reportingClient.from("reporting_sync_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", run.id);
    return { storeId: store.id, status: "failed", error: message };
  }
}
