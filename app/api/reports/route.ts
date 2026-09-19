import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { parseCreateReport, parseUpdateReport, REPORT_SCHEMA_VERSION } from "@/lib/reports/schema";

const reportFields = "id,name,description,report_type,visibility,is_favorite,configuration,definition_version,last_successful_run_at,updated_at,created_at,archived_at";

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { error: workspace.response };
  return {
    supabase: workspace.supabase,
    userId: workspace.userId,
    membership: workspace.membership,
    store: workspace.store,
  };
}

export async function GET(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership } = result;
  const archived = new URL(request.url).searchParams.get("archived") === "true";
  let query = supabase
    .from("saved_reports")
    .select(reportFields)
    .eq("organization_id", membership.organization_id);
  query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const { data, error } = await query
    .order("is_favorite", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const parsed = parseCreateReport(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, description, reportType, visibility, datePreset, utmFilters } = parsed.value;
  const { supabase, userId, membership, store } = result;
  const { data, error } = await supabase.from("saved_reports").insert({
    organization_id: membership.organization_id,
    store_id: store?.id ?? null,
    created_by: userId,
    name,
    description,
    report_type: reportType,
    visibility,
    configuration: { schemaVersion: REPORT_SCHEMA_VERSION, datePreset, ...(utmFilters ? { utmFilters } : {}) },
  }).select(reportFields).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const parsed = parseUpdateReport(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const { supabase, userId, membership, store } = result;
  if (input.action === "duplicate") {
    const { data: original, error: findError } = await supabase.from("saved_reports").select("name,description,report_type,visibility,configuration").eq("id", input.id).eq("organization_id", membership.organization_id).is("archived_at", null).maybeSingle();
    if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
    if (!original) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const name = `${original.name} copy`.slice(0, 120);
    const { data, error } = await supabase.from("saved_reports").insert({
      organization_id: membership.organization_id, store_id: store?.id ?? null, created_by: userId,
      name, description: original.description, report_type: original.report_type, visibility: original.visibility, configuration: original.configuration,
    }).select(reportFields).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: data }, { status: 201 });
  }

  const update: Record<string, string | boolean | null> = { updated_at: new Date().toISOString() };
  if (input.action === "archive") update.archived_at = new Date().toISOString();
  else if (input.action === "restore") update.archived_at = null;
  else if (input.action === "rename") {
    update.name = input.name;
    update.description = input.description;
    if (input.visibility) update.visibility = input.visibility;
  } else if (input.action === "favorite") update.is_favorite = input.isFavorite;

  const { data, error } = await supabase.from("saved_reports").update(update).eq("id", input.id).eq("organization_id", membership.organization_id).select(reportFields).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Report not found or cannot be updated" }, { status: 404 });
  return NextResponse.json({ report: data });
}

export async function DELETE(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Report id is required" }, { status: 400 });
  const { error } = await result.supabase.from("saved_reports").delete().eq("id", id).eq("organization_id", result.membership.organization_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
