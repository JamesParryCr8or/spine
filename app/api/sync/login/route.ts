import { after, NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollingSyncWindow, runReportingSyncForStore } from "@/lib/analytics/reporting-sync";
import { loginRefreshFreshMs, staleReportingRunMs } from "@/lib/analytics/sync-schedule";

export const maxDuration = 90;

/**
 * Called while a signed-in user opens or actively uses a store. Starts a
 * background refresh for the active store unless one finished (or is running)
 * within the last two hours, and returns immediately: the page never waits.
 * Freshness shows up in the top-bar source chips as the refresh completes.
 */
export async function POST(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store, supabase } = workspace;
  if (!store) return NextResponse.json({ started: false, reason: "no_store" });
  const input = await request.json().catch(() => null);
  if (input?.storeId !== store.id) return NextResponse.json({ error: "The selected store changed" }, { status: 409 });

  const { data: latest, error } = await supabase.from("reporting_sync_runs")
    .select("status,created_at,completed_at,window_end").eq("store_id", store.id).in("status", ["running", "completed"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lastActivity = latest?.status === "running" ? latest.created_at : latest?.completed_at ?? null;
  const running = latest?.status === "running" && Date.now() - Date.parse(latest.created_at) < staleReportingRunMs;
  if (running || (latest?.status === "completed" && lastActivity && Date.now() - Date.parse(lastActivity) < loginRefreshFreshMs)) {
    return NextResponse.json({ started: false, reason: running ? "running" : "fresh", nextSyncAt: running ? Date.now() + 60_000 : Date.parse(lastActivity!) + loginRefreshFreshMs });
  }

  const admin = createAdminClient();
  const { from, to } = rollingSyncWindow();
  let lastCoveredDate = latest?.window_end;
  if (latest?.status === "running") {
    const { data: completed, error: completedError } = await supabase.from("reporting_sync_runs").select("window_end").eq("store_id", store.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (completedError) return NextResponse.json({ error: completedError.message }, { status: 500 });
    lastCoveredDate = completed?.window_end;
  }
  const catchupFrom = lastCoveredDate && lastCoveredDate < from ? lastCoveredDate : from;
  after(async () => {
    await runReportingSyncForStore(admin, store, catchupFrom, to, "login", Date.now() + 55_000);
  });
  return NextResponse.json({ started: true, nextSyncAt: Date.now() + loginRefreshFreshMs });
}

/** Lightweight completion polling; contains no credentials or source payloads. */
export async function GET(request: Request) {
  const w = await requireWorkspace();
  if (!w.ok) return w.response;
  if (!w.store || new URL(request.url).searchParams.get("storeId") !== w.store.id) return NextResponse.json({ error: "The selected store changed" }, { status: 409 });
  const { data, error } = await w.supabase.from("reporting_sync_runs").select("status,created_at,completed_at").eq("store_id", w.store.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ run: data });
}
