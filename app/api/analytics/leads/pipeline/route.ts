import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requireWorkspace } from "@/lib/workspace/server";

export const maxDuration = 60;

type PipelineStage = { id?: string; name?: string; position?: number };
type Pipeline = { id?: string; name?: string; stages?: PipelineStage[] };
type Opportunity = { pipelineStageId?: string; status?: string; monetaryValue?: number | string | null };
type OpportunityPage = { opportunities?: Opportunity[]; meta?: { total?: number; nextPage?: number | null }; message?: string; error?: string };

const amount = (value: unknown) => Number(value ?? 0) || 0;

async function ghlContext(storeId: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) throw new Error("GoHighLevel reporting is not configured on the server");
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: token, error } = await admin.rpc("read_connection_secret_for_server", {
    requested_store_id: storeId,
    connection_provider: "gohighlevel",
  });
  if (error || !token) throw new Error(error?.message ?? "No GoHighLevel token is available for this location");
  return { token: token as string, base: "https://services.leadconnectorhq.com" };
}

function parseSelection(value: string | null) {
  if (!value) return {} as { defaultPipelineId?: string; selections?: Array<{ pipelineId?: string }>; includeLaterStages?: boolean };
  try { return JSON.parse(value) as { defaultPipelineId?: string; selections?: Array<{ pipelineId?: string }>; includeLaterStages?: boolean }; }
  catch { return {}; }
}

async function pipelinesFor(locationId: string, token: string, base: string) {
  const response = await fetch(`${base}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { pipelines?: Pipeline[]; message?: string; error?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "GoHighLevel could not load this location’s sales pipelines");
  return (payload.pipelines ?? []).filter((pipeline) => pipeline.id).map((pipeline) => ({
    id: pipeline.id!,
    name: pipeline.name ?? "Unnamed pipeline",
    stages: (pipeline.stages ?? []).filter((stage) => stage.id).map((stage, index) => ({
      id: stage.id!,
      name: stage.name ?? "Unnamed stage",
      position: stage.position ?? index,
    })).sort((a, b) => a.position - b.position),
  }));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) {
    return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const { store, supabase } = workspace;
  const [{ data: connection, error: connectionError }, { data: config, error: configError }] = await Promise.all([
    supabase.from("data_connections").select("status,external_account_id,external_account_name").eq("store_id", store.id).eq("provider", "gohighlevel").maybeSingle(),
    supabase.from("gohighlevel_reporting_configs").select("source_type,selection_id").eq("store_id", store.id).maybeSingle(),
  ]);
  if (connectionError || configError) return NextResponse.json({ error: connectionError?.message ?? configError?.message }, { status: 500 });
  if (!connection?.external_account_id || connection.status !== "connected") {
    return NextResponse.json({ error: "Connect GoHighLevel to see this sales pipeline" }, { status: 400 });
  }

  try {
    const { token, base } = await ghlContext(store.id);
    const pipelines = await pipelinesFor(connection.external_account_id, token, base);
    const selection = parseSelection(config?.selection_id ?? null);
    const requestedPipelineId = params.get("pipelineId");
    const fallbackPipelineId = selection.defaultPipelineId
      ?? selection.selections?.[0]?.pipelineId
      ?? pipelines[0]?.id
      ?? "";
    const pipelineId = pipelines.some((pipeline) => pipeline.id === requestedPipelineId)
      ? requestedPipelineId!
      : fallbackPipelineId;
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline) return NextResponse.json({ error: "No sales pipeline is configured for this GoHighLevel location", pipelines, connection }, { status: 200 });

    const headers = { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" };
    const opportunities: Opportunity[] = [];
    let page = 1;
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const search = new URLSearchParams({
        locationId: connection.external_account_id,
        pipelineId,
        status: "all",
        limit: "100",
        page: String(page),
        getTasks: "false",
        getNotes: "false",
        getCalendarEvents: "false",
      });
      const response = await fetch(`${base}/opportunities/search?${search}`, { headers, cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as OpportunityPage;
      if (!response.ok) return NextResponse.json({ error: payload.message ?? payload.error ?? "GoHighLevel could not load opportunities. Check opportunities.readonly access." }, { status: 502 });
      const items = payload.opportunities ?? [];
      opportunities.push(...items);
      if (payload.meta?.nextPage && payload.meta.nextPage > page) page = payload.meta.nextPage;
      else if (items.length === 100 && (payload.meta?.total === undefined || opportunities.length < payload.meta.total)) page += 1;
      else break;
      if (pageCount === 99) return NextResponse.json({ error: "This pipeline has over 10,000 opportunities. Narrow the pipeline before loading its overview." }, { status: 413 });
    }

    const stageCounts = new Map<string, number>();
    const stageValues = new Map<string, number>();
    let openCount = 0, wonCount = 0, lostCount = 0, openValue = 0, wonValue = 0;
    for (const opportunity of opportunities) {
      const stageId = opportunity.pipelineStageId ?? "";
      if (stageId) {
        stageCounts.set(stageId, (stageCounts.get(stageId) ?? 0) + 1);
        stageValues.set(stageId, (stageValues.get(stageId) ?? 0) + amount(opportunity.monetaryValue));
      }
      const status = (opportunity.status ?? "").toLowerCase();
      const value = amount(opportunity.monetaryValue);
      if (status === "won") { wonCount += 1; wonValue += value; }
      else if (status === "lost" || status === "abandoned") lostCount += 1;
      else { openCount += 1; openValue += value; }
    }

    let metaQuery = supabase.from("meta_ad_insights_daily").select("spend,currency").eq("store_id", store.id);
    let googleQuery = supabase.from("google_ads_insights_daily").select("spend,currency").eq("store_id", store.id);
    if (from) { metaQuery = metaQuery.gte("date_start", from); googleQuery = googleQuery.gte("insight_date", from); }
    if (to) { metaQuery = metaQuery.lte("date_start", to); googleQuery = googleQuery.lte("insight_date", to); }
    const [metaResult, googleResult] = await Promise.all([metaQuery, googleQuery]);
    if (metaResult.error || googleResult.error) return NextResponse.json({ error: metaResult.error?.message ?? googleResult.error?.message }, { status: 500 });
    const metaSpend = (metaResult.data ?? []).filter((row) => row.currency === store.currency).reduce((sum, row) => sum + amount(row.spend), 0);
    const googleSpend = (googleResult.data ?? []).filter((row) => row.currency === store.currency).reduce((sum, row) => sum + amount(row.spend), 0);

    const stages = pipeline.stages.map((stage) => ({
      ...stage,
      count: stageCounts.get(stage.id) ?? 0,
      pipelineValue: stageValues.get(stage.id) ?? 0,
    }));
    return NextResponse.json({
      connection: { name: connection.external_account_name, status: connection.status },
      currency: store.currency,
      pipelines,
      pipelineId,
      pipelineName: pipeline.name,
      stages,
      totals: {
        openCount, wonCount, lostCount, totalCount: opportunities.length,
        openValue, wonValue, averageWonValue: wonCount ? wonValue / wonCount : null,
        winRate: wonCount + lostCount ? wonCount / (wonCount + lostCount) : null,
        metaSpend, googleSpend, totalSpend: metaSpend + googleSpend,
      },
      range: { from, to },
      sourceNote: "Opportunity counts are the current location pipeline snapshot. Ad spend uses the selected date period.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the GoHighLevel pipeline" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { pipelineId?: string };
  const pipelineId = body.pipelineId?.trim();
  if (!pipelineId) return NextResponse.json({ error: "Choose a GoHighLevel sales pipeline" }, { status: 400 });

  const { data: existing, error: readError } = await workspace.supabase.from("gohighlevel_reporting_configs")
    .select("selection_id").eq("store_id", workspace.store.id).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  const selection = parseSelection(existing?.selection_id ?? null);
  const nextSelection = JSON.stringify({ ...selection, defaultPipelineId: pipelineId });
  const { error } = await workspace.supabase.from("gohighlevel_reporting_configs").update({
    selection_id: nextSelection,
    updated_by: workspace.userId,
    updated_at: new Date().toISOString(),
  }).eq("store_id", workspace.store.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, pipelineId });
}
