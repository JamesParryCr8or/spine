import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const reportTypes = new Set(["overview", "pnl", "sales", "products", "customers", "utm"]);
const visibilities = new Set(["private", "organization"]);
const reportFields = "id,name,description,report_type,visibility,is_favorite,updated_at,created_at,archived_at";

async function context() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return { error: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }) };
  const { data: store } = await supabase.from("stores").select("id").eq("organization_id", membership.organization_id).limit(1).single();
  return { supabase, userId, membership, store };
}

export async function GET() {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership } = result;
  const { data, error } = await supabase
    .from("saved_reports")
    .select(reportFields)
    .eq("organization_id", membership.organization_id)
    .is("archived_at", null)
    .order("is_favorite", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, userId, membership, store } = result;
  const input = await request.json().catch(() => null) as { name?: string; description?: string; reportType?: string; visibility?: string } | null;
  const name = input?.name?.trim() ?? "";
  const description = input?.description?.trim() || null;
  const reportType = input?.reportType?.trim() ?? "";
  const visibility = input?.visibility?.trim() ?? "private";
  if (!name || name.length > 120) return NextResponse.json({ error: "Enter a report name of up to 120 characters" }, { status: 400 });
  if (!reportTypes.has(reportType) || !visibilities.has(visibility)) return NextResponse.json({ error: "Choose a valid report type and sharing setting" }, { status: 400 });
  const { data, error } = await supabase.from("saved_reports").insert({
    organization_id: membership.organization_id,
    store_id: store?.id ?? null,
    created_by: userId,
    name,
    description,
    report_type: reportType,
    visibility,
  }).select(reportFields).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const input = await request.json().catch(() => null) as {
    id?: string; action?: "favorite" | "rename" | "archive" | "restore" | "duplicate";
    isFavorite?: boolean; name?: string; description?: string; visibility?: string;
  } | null;
  if (!input?.id) return NextResponse.json({ error: "Report id is required" }, { status: 400 });

  const { supabase, userId, membership, store } = result;
  const scoped = () => supabase.from("saved_reports").eq("id", input.id).eq("organization_id", membership.organization_id);

  if (input.action === "duplicate") {
    const { data: original, error: findError } = await scoped().select("name,description,report_type,visibility").is("archived_at", null).maybeSingle();
    if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
    if (!original) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const name = `${original.name} copy`.slice(0, 120);
    const { data, error } = await supabase.from("saved_reports").insert({
      organization_id: membership.organization_id, store_id: store?.id ?? null, created_by: userId,
      name, description: original.description, report_type: original.report_type, visibility: original.visibility,
    }).select(reportFields).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: data }, { status: 201 });
  }

  const update: Record<string, string | boolean | null> = { updated_at: new Date().toISOString() };
  if (input.action === "archive") update.archived_at = new Date().toISOString();
  else if (input.action === "restore") update.archived_at = null;
  else if (input.action === "rename") {
    const name = input.name?.trim() ?? "";
    const visibility = input.visibility?.trim() ?? "";
    if (!name || name.length > 120) return NextResponse.json({ error: "Enter a report name of up to 120 characters" }, { status: 400 });
    if (visibility && !visibilities.has(visibility)) return NextResponse.json({ error: "Choose a valid sharing setting" }, { status: 400 });
    update.name = name;
    update.description = input.description?.trim() || null;
    if (visibility) update.visibility = visibility;
  } else if (typeof input.isFavorite === "boolean") update.is_favorite = input.isFavorite;
  else return NextResponse.json({ error: "Choose a report update" }, { status: 400 });

  const { data, error } = await scoped().update(update).select(reportFields).maybeSingle();
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
