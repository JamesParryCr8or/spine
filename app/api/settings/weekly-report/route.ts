import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

const canManage = (role: string) => ["owner", "admin"].includes(role);

/** The active store's weekly-report opt-in and destination (owners/admins only). */
export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!canManage(workspace.membership.role)) return NextResponse.json({ enabled: false, webhookUrl: null, globalWebhookConfigured: false, canManage: false });
  const { data, error } = await workspace.supabase.from("weekly_report_settings")
    .select("enabled,webhook_url").eq("store_id", workspace.store.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    enabled: data?.enabled ?? false,
    webhookUrl: data?.webhook_url ?? null,
    globalWebhookConfigured: Boolean(process.env.GHL_WEEKLY_REPORT_WEBHOOK_URL?.trim().startsWith("https://")),
    canManage: true,
  });
}

export async function PUT(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!canManage(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { enabled?: unknown; webhookUrl?: unknown } | null;
  const enabled = body?.enabled === true;
  const webhookUrl = typeof body?.webhookUrl === "string" && body.webhookUrl.trim() ? body.webhookUrl.trim() : null;
  if (webhookUrl) {
    let parsed: URL | null = null;
    try { parsed = new URL(webhookUrl); } catch { /* handled below */ }
    if (!parsed || parsed.protocol !== "https:") return NextResponse.json({ error: "Use an https:// webhook URL" }, { status: 400 });
  }
  const globalWebhookConfigured = Boolean(process.env.GHL_WEEKLY_REPORT_WEBHOOK_URL?.trim().startsWith("https://"));
  if (enabled && !webhookUrl && !globalWebhookConfigured) return NextResponse.json({ error: "Add a webhook URL to turn the weekly report on" }, { status: 400 });

  const { error } = await workspace.supabase.from("weekly_report_settings").upsert({
    store_id: workspace.store.id,
    organization_id: workspace.store.organization_id,
    enabled,
    webhook_url: webhookUrl,
    updated_by: workspace.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enabled, webhookUrl, globalWebhookConfigured, canManage: true });
}
