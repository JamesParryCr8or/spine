import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requireWorkspace } from "@/lib/workspace/server";

export const maxDuration = 60;

type StageSelection = { pipelineId: string; stageId: string; position: number };
type Pipeline = { id?: string; stages?: Array<{ id?: string; position?: number }> };
type Opportunity = { pipelineId?: string; pipelineStageId?: string; createdAt?: string; lastStageChangeAt?: string };
type OpportunityPage = { opportunities?: Opportunity[]; meta?: { total?: number; nextPage?: number | null; startAfter?: number | null; startAfterId?: string | null }; message?: string; error?: string };

export async function POST() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required to sync GoHighLevel" }, { status: 403 });

  const { store, supabase } = workspace;
  const [{ data: connection, error: connectionError }, { data: config, error: configError }] = await Promise.all([
    supabase.from("data_connections").select("external_account_id").eq("store_id", store.id).eq("provider", "gohighlevel").maybeSingle(),
    supabase.from("gohighlevel_reporting_configs").select("source_type,selection_id,selection_name,metric_label").eq("store_id", store.id).maybeSingle(),
  ]);
  if (connectionError || configError) return NextResponse.json({ error: connectionError?.message ?? configError?.message }, { status: 500 });
  if (!connection?.external_account_id || !config) return NextResponse.json({ error: "Connect GoHighLevel and choose an opportunity stage first" }, { status: 400 });
  if (config.source_type !== "opportunities") return NextResponse.json({ error: "This sync currently imports pipeline opportunities. Choose opportunities in your GoHighLevel connection settings." }, { status: 400 });

  let parsed: { selections?: StageSelection[]; includeLaterStages?: boolean };
  try {
    parsed = JSON.parse(config.selection_id ?? "") as { selections?: StageSelection[]; includeLaterStages?: boolean };
  } catch {
    return NextResponse.json({ error: "Choose your GoHighLevel pipeline stage again before syncing" }, { status: 400 });
  }
  const selections = (parsed.selections ?? []).filter((item) => item.pipelineId && item.stageId);
  if (!selections.length) return NextResponse.json({ error: "Choose at least one GoHighLevel pipeline stage before syncing" }, { status: 400 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) return NextResponse.json({ error: "GoHighLevel sync is not configured on the server" }, { status: 500 });
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: token, error: tokenError } = await admin.rpc("read_connection_secret_for_server", {
    requested_store_id: store.id,
    connection_provider: "gohighlevel",
  });
  if (tokenError || !token) return NextResponse.json({ error: tokenError?.message ?? "No GoHighLevel token is available" }, { status: 400 });

  const headers = { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" };
  const base = "https://services.leadconnectorhq.com";
  const pipelinesResponse = await fetch(`${base}/opportunities/pipelines?locationId=${encodeURIComponent(connection.external_account_id)}`, { headers, cache: "no-store" });
  const pipelinesPayload = await pipelinesResponse.json().catch(() => ({})) as { pipelines?: Pipeline[]; message?: string; error?: string };
  if (!pipelinesResponse.ok) return NextResponse.json({ error: pipelinesPayload.message ?? pipelinesPayload.error ?? "GoHighLevel could not load pipeline stages" }, { status: 400 });

  const stagePositions = new Map<string, Map<string, number>>();
  for (const pipeline of pipelinesPayload.pipelines ?? []) {
    if (!pipeline.id) continue;
    stagePositions.set(pipeline.id, new Map((pipeline.stages ?? []).filter((stage) => stage.id).map((stage, index) => [stage.id!, stage.position ?? index] as const)));
  }
  const selectionsByPipeline = new Map<string, StageSelection[]>();
  for (const selection of selections) selectionsByPipeline.set(selection.pipelineId, [...(selectionsByPipeline.get(selection.pipelineId) ?? []), selection]);

  const counts = new Map<string, number>();
  let importedOpportunities = 0;
  for (const [pipelineId, pipelineSelections] of selectionsByPipeline) {
    let page = 1;
    let fetched = 0;
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const params = new URLSearchParams({
        locationId: connection.external_account_id,
        pipelineId,
        status: "all",
        limit: "100",
        page: String(page),
        getTasks: "false",
        getNotes: "false",
        getCalendarEvents: "false",
      });
      const response = await fetch(`${base}/opportunities/search?${params}`, { headers, cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as OpportunityPage;
      if (!response.ok) return NextResponse.json({ error: payload.message ?? payload.error ?? "GoHighLevel could not load opportunities. Check the opportunities.readonly permission." }, { status: 400 });

      const opportunities = payload.opportunities ?? [];
      fetched += opportunities.length;
      const positions = stagePositions.get(pipelineId);
      const selectedPositions = pipelineSelections.map((item) => item.position).filter(Number.isFinite);
      const firstSelectedPosition = selectedPositions.length ? Math.min(...selectedPositions) : 0;
      for (const opportunity of opportunities) {
        if (opportunity.pipelineId !== pipelineId || !opportunity.pipelineStageId) continue;
        const selectedExact = pipelineSelections.some((item) => item.stageId === opportunity.pipelineStageId);
        const currentPosition = positions?.get(opportunity.pipelineStageId);
        const progressedPastSelection = parsed.includeLaterStages !== false && currentPosition !== undefined && currentPosition >= firstSelectedPosition;
        if (!selectedExact && !progressedPastSelection) continue;
        const eventDate = (opportunity.lastStageChangeAt ?? opportunity.createdAt ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue;
        counts.set(eventDate, (counts.get(eventDate) ?? 0) + 1);
        importedOpportunities += 1;
      }

      const total = payload.meta?.total;
      const nextPage = payload.meta?.nextPage;
      if (nextPage && nextPage > page) page = nextPage;
      else if (opportunities.length === 100 && (total === undefined || fetched < total)) page += 1;
      else break;

      if (pageCount === 99) return NextResponse.json({ error: "GoHighLevel returned more than 10,000 opportunities for a pipeline. Narrow the selected pipeline stages before syncing." }, { status: 413 });
    }
  }

  const { error: deleteError } = await supabase.from("gohighlevel_leads_daily").delete().eq("store_id", store.id).eq("source_type", "opportunities");
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const rows = [...counts].map(([metric_date, lead_count]) => ({
    organization_id: workspace.membership.organizationId,
    store_id: store.id,
    metric_date,
    source_type: "opportunities",
    selection_id: config.selection_id,
    metric_label: config.metric_label,
    lead_count,
    synced_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await supabase.from("gohighlevel_leads_daily").upsert(rows, { onConflict: "store_id,metric_date,source_type,metric_label" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ importedOpportunities, importedDays: rows.length, metricLabel: config.metric_label, selectionName: config.selection_name });
}
