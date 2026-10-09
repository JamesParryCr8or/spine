import type { SupabaseClient } from "@supabase/supabase-js";

import { getReachedPipelineStages } from "./gohighlevel-stage-series.ts";

type StageSelection = { pipelineId: string; pipelineName?: string; stageId: string; stageName?: string; position: number };
type Pipeline = { id?: string; stages?: Array<{ id?: string; position?: number }> };
type Opportunity = { pipelineId?: string; pipelineStageId?: string; createdAt?: string; lastStageChangeAt?: string };
type OpportunityPage = { opportunities?: Opportunity[]; meta?: { total?: number; nextPage?: number | null; startAfter?: number | null; startAfterId?: string | null }; message?: string; error?: string };

export type GoHighLevelSyncResult =
  | { ok: true; importedOpportunities: number; importedDays: number; metricLabel: string | null; selectionName: string | null }
  /** `notConfigured` means there is nothing to sync yet; the cron job skips these stores quietly. */
  | { ok: false; status: number; error: string; notConfigured?: boolean };

/**
 * Imports GoHighLevel pipeline opportunities into gohighlevel_leads_daily for
 * one store. `dataClient` reads the store's config and writes the rows: the
 * signed-in user's client from the manual button, a service-role client from
 * the cron job. `secretClient` must be service-role to read the stored token.
 */
export async function syncGoHighLevelOpportunities(
  dataClient: SupabaseClient,
  secretClient: SupabaseClient,
  store: { id: string; organization_id: string },
): Promise<GoHighLevelSyncResult> {
  const [{ data: connection, error: connectionError }, { data: config, error: configError }] = await Promise.all([
    dataClient.from("data_connections").select("external_account_id").eq("store_id", store.id).eq("provider", "gohighlevel").maybeSingle(),
    dataClient.from("gohighlevel_reporting_configs").select("source_type,selection_id,selection_name,metric_label").eq("store_id", store.id).maybeSingle(),
  ]);
  if (connectionError || configError) return { ok: false, status: 500, error: connectionError?.message ?? configError?.message ?? "GoHighLevel settings could not be read" };
  if (!connection?.external_account_id || !config) return { ok: false, status: 400, error: "Connect GoHighLevel and choose an opportunity stage first", notConfigured: true };
  if (config.source_type !== "opportunities") return { ok: false, status: 400, error: "This sync currently imports pipeline opportunities. Choose opportunities in your GoHighLevel connection settings.", notConfigured: true };

  let parsed: { selections?: StageSelection[]; includeLaterStages?: boolean };
  try {
    parsed = JSON.parse(config.selection_id ?? "") as { selections?: StageSelection[]; includeLaterStages?: boolean };
  } catch {
    return { ok: false, status: 400, error: "Choose your GoHighLevel pipeline stage again before syncing", notConfigured: true };
  }
  const selections = (parsed.selections ?? []).filter((item) => item.pipelineId && item.stageId);
  if (!selections.length) return { ok: false, status: 400, error: "Choose at least one GoHighLevel pipeline stage before syncing", notConfigured: true };

  const { data: token, error: tokenError } = await secretClient.rpc("read_connection_secret_for_server", {
    requested_store_id: store.id,
    connection_provider: "gohighlevel",
  });
  if (tokenError || !token) return { ok: false, status: 400, error: tokenError?.message ?? "No GoHighLevel token is available" };

  const locationId = connection.external_account_id as string;
  const headers = { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" };
  const base = "https://services.leadconnectorhq.com";
  const pipelinesResponse = await fetch(`${base}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers, cache: "no-store" });
  const pipelinesPayload = await pipelinesResponse.json().catch(() => ({})) as { pipelines?: Pipeline[]; message?: string; error?: string };
  if (!pipelinesResponse.ok) return { ok: false, status: 400, error: pipelinesPayload.message ?? pipelinesPayload.error ?? "GoHighLevel could not load pipeline stages" };

  const stagePositions = new Map<string, Map<string, number>>();
  for (const pipeline of pipelinesPayload.pipelines ?? []) {
    if (!pipeline.id) continue;
    stagePositions.set(pipeline.id, new Map((pipeline.stages ?? []).filter((stage) => stage.id).map((stage, index) => [stage.id!, stage.position ?? index] as const)));
  }
  const selectionsByPipeline = new Map<string, StageSelection[]>();
  for (const selection of selections) selectionsByPipeline.set(selection.pipelineId, [...(selectionsByPipeline.get(selection.pipelineId) ?? []), selection]);

  const counts = new Map<string, number>();
  const stageCounts = new Map<string, number>();
  let importedOpportunities = 0;
  for (const [pipelineId, pipelineSelections] of selectionsByPipeline) {
    let page = 1;
    let fetched = 0;
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const params = new URLSearchParams({
        locationId,
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
      if (!response.ok) return { ok: false, status: 400, error: payload.message ?? payload.error ?? "GoHighLevel could not load opportunities. Check the opportunities.readonly permission." };

      const opportunities = payload.opportunities ?? [];
      fetched += opportunities.length;
      const positions = stagePositions.get(pipelineId);
      for (const opportunity of opportunities) {
        if (opportunity.pipelineId !== pipelineId || !opportunity.pipelineStageId) continue;
        const currentPosition = positions?.get(opportunity.pipelineStageId);
        const reachedSelections = getReachedPipelineStages(pipelineId, opportunity.pipelineStageId, currentPosition, pipelineSelections, parsed.includeLaterStages !== false);
        if (!reachedSelections.length) continue;
        const eventDate = (opportunity.lastStageChangeAt ?? opportunity.createdAt ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue;
        counts.set(eventDate, (counts.get(eventDate) ?? 0) + 1);
        for (const selection of reachedSelections) {
          const key = `${eventDate}|stage:${selection.pipelineId}:${selection.stageId}`;
          stageCounts.set(key, (stageCounts.get(key) ?? 0) + 1);
        }
        importedOpportunities += 1;
      }

      const total = payload.meta?.total;
      const nextPage = payload.meta?.nextPage;
      if (nextPage && nextPage > page) page = nextPage;
      else if (opportunities.length === 100 && (total === undefined || fetched < total)) page += 1;
      else break;

      if (pageCount === 99) return { ok: false, status: 413, error: "GoHighLevel returned more than 10,000 opportunities for a pipeline. Narrow the selected pipeline stages before syncing." };
    }
  }

  const { error: deleteError } = await dataClient.from("gohighlevel_leads_daily").delete().eq("store_id", store.id).eq("source_type", "opportunities");
  if (deleteError) return { ok: false, status: 500, error: deleteError.message };

  const syncedAt = new Date().toISOString();
  const rows = [...counts].map(([metric_date, lead_count]) => ({
    organization_id: store.organization_id,
    store_id: store.id,
    metric_date,
    source_type: "opportunities",
    selection_id: config.selection_id,
    metric_label: config.metric_label,
    lead_count,
    synced_at: syncedAt,
  })).concat([...stageCounts].map(([key, lead_count]) => {
    const separator = key.indexOf("|");
    return {
      organization_id: store.organization_id,
      store_id: store.id,
      metric_date: key.slice(0, separator),
      source_type: "opportunities",
      selection_id: config.selection_id,
      metric_label: key.slice(separator + 1),
      lead_count,
      synced_at: syncedAt,
    };
  }));
  if (rows.length) {
    const { error } = await dataClient.from("gohighlevel_leads_daily").upsert(rows, { onConflict: "store_id,metric_date,source_type,metric_label" });
    if (error) return { ok: false, status: 500, error: error.message };
  }

  return { ok: true, importedOpportunities, importedDays: rows.length, metricLabel: config.metric_label, selectionName: config.selection_name };
}
