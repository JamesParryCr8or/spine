import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";

function readAverageOrderValue(selectionId: string | null) {
  try {
    const value = Number((JSON.parse(selectionId ?? "{}") as { averageOrderValue?: unknown }).averageOrderValue);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const { data, error } = await workspace.supabase.from("gohighlevel_reporting_configs")
    .select("selection_id").eq("store_id", workspace.store.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ averageOrderValue: readAverageOrderValue(data?.selection_id ?? null), currency: workspace.store.currency, canManage: ["owner", "admin"].includes(workspace.membership.role) });
}

export async function PUT(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { averageOrderValue?: unknown } | null;
  const averageOrderValue = typeof body?.averageOrderValue === "number" || typeof body?.averageOrderValue === "string" ? Number(body.averageOrderValue) : Number.NaN;
  if (!Number.isFinite(averageOrderValue) || averageOrderValue < 0 || averageOrderValue > 1000000000) return NextResponse.json({ error: "Average order value must be between 0 and 1,000,000,000" }, { status: 400 });

  const { data: existing, error: readError } = await workspace.supabase.from("gohighlevel_reporting_configs")
    .select("source_type,selection_id,selection_name,metric_label,created_by")
    .eq("store_id", workspace.store.id).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  let selection: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existing?.selection_id ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) selection = parsed as Record<string, unknown>;
  } catch { /* Replace malformed legacy configuration with a valid settings object. */ }
  const { error } = await workspace.supabase.from("gohighlevel_reporting_configs").upsert({
    organization_id: workspace.membership.organizationId,
    store_id: workspace.store.id,
    source_type: existing?.source_type ?? "opportunities",
    selection_id: JSON.stringify({ ...selection, averageOrderValue }),
    selection_name: existing?.selection_name ?? null,
    metric_label: existing?.metric_label ?? "Qualified leads",
    created_by: existing?.created_by ?? workspace.userId,
    updated_by: workspace.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ averageOrderValue, currency: workspace.store.currency, canManage: true });
}
