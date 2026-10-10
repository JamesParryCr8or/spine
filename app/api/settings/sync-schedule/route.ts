import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { defaultSyncHour } from "@/lib/analytics/sync-schedule";

const canManage = (role: string) => ["owner", "admin"].includes(role);

/** The active store's daily refresh schedule. Any member can read it. */
export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const { data, error } = await workspace.supabase.from("store_sync_schedule")
    .select("enabled,sync_hour").eq("store_id", workspace.store.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    enabled: data?.enabled ?? true,
    syncHour: data?.sync_hour ?? defaultSyncHour,
    timezone: workspace.store.timezone || "UTC",
    canManage: canManage(workspace.membership.role),
  });
}

export async function PUT(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!canManage(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { enabled?: unknown; syncHour?: unknown } | null;
  const syncHour = Number(body?.syncHour);
  if (!Number.isInteger(syncHour) || syncHour < 0 || syncHour > 23) return NextResponse.json({ error: "Choose an hour between 0 and 23" }, { status: 400 });
  const enabled = body?.enabled !== false;
  const { error } = await workspace.supabase.from("store_sync_schedule").upsert({
    store_id: workspace.store.id,
    organization_id: workspace.store.organization_id,
    enabled,
    sync_hour: syncHour,
    updated_by: workspace.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enabled, syncHour, timezone: workspace.store.timezone || "UTC", canManage: true });
}
