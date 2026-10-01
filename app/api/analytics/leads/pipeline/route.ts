import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requireWorkspace } from "@/lib/workspace/server";
import { calculateJourneyCounts } from "@/lib/analytics/lead-funnel";

export const maxDuration = 60;

type PipelineStage = { id?: string; name?: string; position?: number };
type Pipeline = { id?: string; name?: string; stages?: PipelineStage[] };
type Opportunity = { id?: string; name?: string; pipelineStageId?: string; status?: string; monetaryValue?: number | string | null; source?: string; assignedTo?: string; createdAt?: string; lastStageChangeAt?: string; lastStatusChangeAt?: string; forecastExpectedCloseDate?: string; forecastProbability?: number | string; effectiveProbability?: number | string; lostReasonId?: string; lostReason?: string; tasks?: unknown[]; calendarEvents?: unknown[] };
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

type FunnelStageMap = { leadStageId?: string; bookedCallStageId?: string; purchaseStageId?: string };
type ReportingSelection = { defaultPipelineId?: string; selections?: Array<{ pipelineId?: string }>; includeLaterStages?: boolean; funnelStages?: FunnelStageMap; averageOrderValue?: number };

function parseSelection(value: string | null): ReportingSelection {
  if (!value) return {};
  try { return JSON.parse(value) as ReportingSelection; }
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
  const details = params.get("details") === "1";
  const includeFollowups = details && params.get("includeFollowups") === "1";
  const includeLostReasons = details && params.get("includeLostReasons") === "1";
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
    const stageIds = new Set(pipeline.stages.map((stage) => stage.id));
    const savedFunnel = selection.funnelStages;
    const inferredLead = pipeline.stages[0]?.id ?? "";
    const inferredBooked = pipeline.stages.find((stage) => /book|call|appointment|demo|consult/i.test(stage.name))?.id ?? pipeline.stages[Math.min(1, pipeline.stages.length - 1)]?.id ?? "";
    const inferredPurchase = pipeline.stages.find((stage) => /purchase|won|closed|sale/i.test(stage.name))?.id ?? pipeline.stages[pipeline.stages.length - 1]?.id ?? "";
    const funnelStages = {
      leadStageId: savedFunnel?.leadStageId && stageIds.has(savedFunnel.leadStageId) ? savedFunnel.leadStageId : inferredLead,
      bookedCallStageId: savedFunnel?.bookedCallStageId && stageIds.has(savedFunnel.bookedCallStageId) ? savedFunnel.bookedCallStageId : inferredBooked,
      purchaseStageId: savedFunnel?.purchaseStageId && stageIds.has(savedFunnel.purchaseStageId) ? savedFunnel.purchaseStageId : inferredPurchase,
    };

    const headers = { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" };
    const opportunities: Opportunity[] = [];
    let followupsNote: string | undefined;
    let page = 1;
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const search = new URLSearchParams({
        locationId: connection.external_account_id,
        pipelineId,
        status: "all",
        limit: "100",
        page: String(page),
        getTasks: String(includeFollowups),
        getNotes: "false",
        getCalendarEvents: String(includeFollowups),
      });
      let response = await fetch(`${base}/opportunities/search?${search}`, { headers, cache: "no-store" });
      let payload = await response.json().catch(() => ({})) as OpportunityPage;
      if (!response.ok && includeFollowups) {
        const fallback = new URLSearchParams(search);
        fallback.set("getTasks", "false");
        fallback.set("getCalendarEvents", "false");
        response = await fetch(`${base}/opportunities/search?${fallback}`, { headers, cache: "no-store" });
        payload = await response.json().catch(() => ({})) as OpportunityPage;
        if (response.ok) followupsNote = "GHL did not allow embedded task or appointment details. Opportunity reports still work; check task/calendar permissions to enable follow-ups.";
      }
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
    let bingQuery = supabase.from("bing_ads_insights_daily").select("spend,currency").eq("store_id", store.id);
    if (from) { metaQuery = metaQuery.gte("date_start", from); googleQuery = googleQuery.gte("insight_date", from); bingQuery = bingQuery.gte("insight_date", from); }
    if (to) { metaQuery = metaQuery.lte("date_start", to); googleQuery = googleQuery.lte("insight_date", to); bingQuery = bingQuery.lte("insight_date", to); }
    const [metaResult, googleResult, bingResult] = await Promise.all([metaQuery, googleQuery, bingQuery]);
    if (metaResult.error || googleResult.error || bingResult.error) return NextResponse.json({ error: metaResult.error?.message ?? googleResult.error?.message ?? bingResult.error?.message }, { status: 500 });
    const metaSpend = (metaResult.data ?? []).filter((row) => row.currency === store.currency).reduce((sum, row) => sum + amount(row.spend), 0);
    const googleSpend = (googleResult.data ?? []).filter((row) => row.currency === store.currency).reduce((sum, row) => sum + amount(row.spend), 0);
    const bingSpend = (bingResult.data ?? []).filter((row) => row.currency === store.currency).reduce((sum, row) => sum + amount(row.spend), 0);

    let lostReasons: Array<{ id: string; name: string }> = [];
    if (includeLostReasons) {
      try {
        const response = await fetch(`${base}/opportunities/lost-reason?locationId=${encodeURIComponent(connection.external_account_id)}`, { headers, cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as { lostReasons?: Array<{ id?: string; name?: string }> };
        if (response.ok) lostReasons = (payload.lostReasons ?? []).filter((reason) => reason.id && reason.name).map((reason) => ({ id: reason.id!, name: reason.name! }));
      } catch { /* The report still works with GHL lost-reason IDs. */ }
    }

    const stages = pipeline.stages.map((stage) => ({
      ...stage,
      count: stageCounts.get(stage.id) ?? 0,
      pipelineValue: stageValues.get(stage.id) ?? 0,
    }));
    const stagePositions = new Map(pipeline.stages.map((stage, index) => [stage.id, index]));
    const journeyCounts = calculateJourneyCounts(opportunities, stagePositions, funnelStages);
    return NextResponse.json({
      connection: { name: connection.external_account_name, status: connection.status },
      currency: store.currency,
      pipelines,
      pipelineId,
      pipelineName: pipeline.name,
      stages,
      funnelStages,
      journeyCounts,
      averageOrderValue: Number(selection.averageOrderValue) > 0 ? Number(selection.averageOrderValue) : null,
      ...(details ? { opportunities: opportunities.map((opportunity) => ({
        id: opportunity.id, name: opportunity.name, pipelineStageId: opportunity.pipelineStageId,
        status: opportunity.status, monetaryValue: opportunity.monetaryValue, source: opportunity.source,
        assignedTo: opportunity.assignedTo, createdAt: opportunity.createdAt, lastStageChangeAt: opportunity.lastStageChangeAt,
        lastStatusChangeAt: opportunity.lastStatusChangeAt, forecastExpectedCloseDate: opportunity.forecastExpectedCloseDate,
        forecastProbability: opportunity.forecastProbability, effectiveProbability: opportunity.effectiveProbability,
        lostReasonId: opportunity.lostReasonId, lostReason: opportunity.lostReason,
        ...(includeFollowups ? { tasks: Array.isArray(opportunity.tasks) ? opportunity.tasks : [], calendarEvents: Array.isArray(opportunity.calendarEvents) ? opportunity.calendarEvents : [] } : {}),
      })), lostReasons, ...(includeFollowups ? { followupsAvailable: opportunities.some((o) => (o.tasks?.length ?? 0) + (o.calendarEvents?.length ?? 0) > 0), followupsNote: followupsNote ?? (opportunities.some((o) => (o.tasks?.length ?? 0) + (o.calendarEvents?.length ?? 0) > 0) ? undefined : "GoHighLevel did not return tasks or calendar events for these opportunities. Confirm task/calendar permissions and that records are linked to pipeline contacts.") } : {}) } : {}),
      totals: {
        openCount, wonCount, lostCount, totalCount: opportunities.length,
        openValue, wonValue, averageWonValue: wonCount ? wonValue / wonCount : null,
        winRate: wonCount + lostCount ? wonCount / (wonCount + lostCount) : null,
        metaSpend, googleSpend, bingSpend, totalSpend: metaSpend + googleSpend + bingSpend,
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
  const body = await request.json().catch(() => ({})) as { pipelineId?: string; funnelStages?: FunnelStageMap };
  const pipelineId = body.pipelineId?.trim();
  if (!pipelineId && !body.funnelStages) return NextResponse.json({ error: "Choose a pipeline or funnel stages to save" }, { status: 400 });

  const { data: existing, error: readError } = await workspace.supabase.from("gohighlevel_reporting_configs")
    .select("selection_id").eq("store_id", workspace.store.id).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  const selection = parseSelection(existing?.selection_id ?? null);
  if (body.funnelStages) {
    const values = [body.funnelStages.leadStageId, body.funnelStages.bookedCallStageId, body.funnelStages.purchaseStageId];
    if (values.some((value) => typeof value !== "string" || !value.trim())) return NextResponse.json({ error: "Choose a GoHighLevel stage for leads, booked calls and purchases" }, { status: 400 });
    selection.funnelStages = {
      leadStageId: body.funnelStages.leadStageId!.trim(),
      bookedCallStageId: body.funnelStages.bookedCallStageId!.trim(),
      purchaseStageId: body.funnelStages.purchaseStageId!.trim(),
    };
  }
  const nextSelection = JSON.stringify({ ...selection, ...(pipelineId ? { defaultPipelineId: pipelineId } : {}) });
  const { error } = await workspace.supabase.from("gohighlevel_reporting_configs").update({
    selection_id: nextSelection,
    updated_by: workspace.userId,
    updated_at: new Date().toISOString(),
  }).eq("store_id", workspace.store.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, pipelineId });
}

