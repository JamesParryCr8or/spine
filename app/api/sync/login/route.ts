import { after, NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollingSyncWindow, runReportingSyncForStore } from "@/lib/analytics/reporting-sync";
import { loginRefreshFreshMs } from "@/lib/analytics/sync-schedule";

export const maxDuration = 90;

/**
 * Called once per browser session when someone opens the app. Starts a
 * background refresh for the active store unless one finished (or is running)
 * within the last few hours, and returns immediately: the page never waits.
 * Freshness shows up in the top-bar source chips as the refresh completes.
 */
export async function POST() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store, supabase } = workspace;
  if (!store) return NextResponse.json({ started: false, reason: "no_store" });

  const { data: latest, error } = await supabase.from("reporting_sync_runs")
    .select("status,created_at,completed_at").eq("store_id", store.id).in("status", ["running", "completed"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lastActivity = latest?.status === "running" ? latest.created_at : latest?.completed_at ?? null;
  if (latest?.status === "running" || (lastActivity && Date.now() - Date.parse(lastActivity) < loginRefreshFreshMs)) {
    return NextResponse.json({ started: false, reason: "fresh" });
  }

  const admin = createAdminClient();
  const { from, to } = rollingSyncWindow();
  after(async () => {
    await runReportingSyncForStore(admin, store, from, to, "login", Date.now() + 55_000);
  });
  return NextResponse.json({ started: true });
}
