import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

type SourceType = "contacts" | "opportunities";

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { response: workspace.response };
  if (!workspace.store) return { response: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  return { ...workspace, store: workspace.store, response: null };
}

export async function GET() {
  const result = await context();
  if (result.response) return result.response;
  const [connection, config] = await Promise.all([
    result.supabase.from("data_connections").select("provider,status,external_account_id,external_account_name,last_verified_at,last_error").eq("store_id", result.store.id).eq("provider", "gohighlevel").maybeSingle(),
    result.supabase.from("gohighlevel_reporting_configs").select("source_type,selection_id,selection_name,metric_label,updated_at").eq("store_id", result.store.id).maybeSingle(),
  ]);
  if (connection.error || config.error) return NextResponse.json({ error: connection.error?.message ?? config.error?.message }, { status: 500 });
  return NextResponse.json({ connection: connection.data, config: config.data });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin"].includes(result.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    apiKey?: string; locationId?: string; sourceType?: SourceType; selectionId?: string; selectionName?: string; metricLabel?: string;
  };
  const apiKey = body.apiKey?.trim();
  const locationId = body.locationId?.trim();
  const sourceType = body.sourceType;
  const metricLabel = body.metricLabel?.trim();
  if (!apiKey || !locationId || (sourceType !== "contacts" && sourceType !== "opportunities") || !metricLabel) {
    return NextResponse.json({ error: "Enter a private integration key, location ID, source and conversion name" }, { status: 400 });
  }
  if (metricLabel.length > 80) return NextResponse.json({ error: "The conversion name must be 80 characters or fewer" }, { status: 400 });

  const verified = await fetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28", Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await verified.json().catch(() => ({})) as { location?: { id?: string; name?: string }; message?: string; error?: string };
  if (!verified.ok) return NextResponse.json({ error: payload.message ?? payload.error ?? "GoHighLevel rejected the private integration key or location ID" }, { status: 400 });
  const account = payload.location;
  if (!account?.id) return NextResponse.json({ error: "GoHighLevel did not return the requested location" }, { status: 400 });

  const saved = await result.supabase.rpc("save_data_connection", {
    connection_provider: "gohighlevel", requested_store_id: result.store.id, access_token: apiKey,
    account_id: account.id, account_name: account.name ?? account.id,
  });
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });

  const { data: config, error } = await result.supabase.from("gohighlevel_reporting_configs").upsert({
    organization_id: result.membership.organizationId, store_id: result.store.id, source_type: sourceType,
    selection_id: body.selectionId?.trim() || null, selection_name: body.selectionName?.trim() || null,
    metric_label: metricLabel, created_by: result.userId, updated_by: result.userId,
  }, { onConflict: "store_id" }).select("source_type,selection_id,selection_name,metric_label,updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: Array.isArray(saved.data) ? saved.data[0] : saved.data, config });
}


export async function PATCH(request: Request) {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin"].includes(result.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { selections?: Array<{ pipelineId?: string; pipelineName?: string; stageId?: string; stageName?: string; position?: number }>; includeLaterStages?: boolean };
  const selections = (body.selections ?? []).filter((selection) => selection.stageId?.trim() && selection.pipelineId?.trim() && selection.pipelineName?.trim() && selection.stageName?.trim());
  if (!selections.length) return NextResponse.json({ error: "Choose at least one pipeline stage" }, { status: 400 });
  const { data: existingConfig, error: existingConfigError } = await result.supabase
    .from("gohighlevel_reporting_configs").select("selection_id").eq("store_id", result.store.id).maybeSingle();
  if (existingConfigError) return NextResponse.json({ error: existingConfigError.message }, { status: 500 });
  let defaultPipelineId: string | undefined;
  try {
    const parsed = JSON.parse(existingConfig?.selection_id ?? "") as { defaultPipelineId?: string };
    defaultPipelineId = parsed.defaultPipelineId;
  } catch { /* Older stage selections have no saved default pipeline. */ }
  const selectionId = JSON.stringify({
    selections: selections.map((selection) => ({ pipelineId: selection.pipelineId!.trim(), stageId: selection.stageId!.trim(), position: Number(selection.position) || 0 })),
    includeLaterStages: body.includeLaterStages !== false,
    ...(defaultPipelineId ? { defaultPipelineId } : {}),
  });
  const selectionName = selections.map((selection) => `${selection.pipelineName!.trim()} — ${selection.stageName!.trim()}`).join(", ");
  const metricLabel = selections.length === 1 ? selections[0].stageName!.trim() : "selected stages";
  const { data, error } = await result.supabase.from("gohighlevel_reporting_configs").update({
    source_type: "opportunities", selection_id: selectionId, selection_name: selectionName, metric_label: metricLabel, updated_by: result.userId, updated_at: new Date().toISOString(),
  }).eq("store_id", result.store.id).select("source_type,selection_id,selection_name,metric_label,updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}

export async function DELETE() {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin"].includes(result.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const [config, connection] = await Promise.all([
    result.supabase.from("gohighlevel_reporting_configs").delete().eq("store_id", result.store.id),
    result.supabase.rpc("delete_data_connection", { connection_provider: "gohighlevel", requested_store_id: result.store.id }),
  ]);
  if (config.error || connection.error) return NextResponse.json({ error: config.error?.message ?? connection.error?.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
