import { NextResponse } from "next/server";

import { parseFinishReportRun, parseStartReportRun } from "@/lib/reports/schema";
import { createClient } from "@/lib/supabase/server";

async function context() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return { error: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }) };
  return { supabase, userId, organizationId: membership.organization_id };
}

export async function GET(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const parsed = parseStartReportRun({ reportId: new URL(request.url).searchParams.get("reportId") });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data, error } = await result.supabase
    .from("saved_report_runs")
    .select("id,report_id,definition_version,status,row_count,error_message,started_at,completed_at")
    .eq("organization_id", result.organizationId)
    .eq("report_id", parsed.value.reportId)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const parsed = parseStartReportRun(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data: report, error: reportError } = await result.supabase
    .from("saved_reports")
    .select("id,store_id,definition_version")
    .eq("id", parsed.value.reportId)
    .eq("organization_id", result.organizationId)
    .is("archived_at", null)
    .maybeSingle();
  if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const { data, error } = await result.supabase.from("saved_report_runs").insert({
    report_id: report.id,
    organization_id: result.organizationId,
    store_id: report.store_id,
    definition_version: report.definition_version,
    status: "running",
    created_by: result.userId,
  }).select("id,report_id,definition_version,status,started_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ run: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const parsed = parseFinishReportRun(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const completedAt = new Date().toISOString();
  const { data, error } = await result.supabase.from("saved_report_runs").update({
    status: parsed.value.status,
    row_count: parsed.value.rowCount,
    error_message: parsed.value.status === "failed" ? parsed.value.errorMessage ?? "Report data could not be loaded" : null,
    completed_at: completedAt,
  }).eq("id", parsed.value.runId)
    .eq("organization_id", result.organizationId)
    .eq("created_by", result.userId)
    .eq("status", "running")
    .select("id,report_id,definition_version,status,row_count,error_message,started_at,completed_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Report run not found or already finished" }, { status: 404 });
  if (data.status === "completed") {
    const { error: reportError } = await result.supabase.from("saved_reports")
      .update({ last_successful_run_at: completedAt })
      .eq("id", data.report_id)
      .eq("organization_id", result.organizationId);
    if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 });
  }
  return NextResponse.json({ run: data });
}
