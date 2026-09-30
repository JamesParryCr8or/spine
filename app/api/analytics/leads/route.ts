import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const amount = (value: unknown) => Number(value ?? 0) || 0;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if ((from && !isDate(from)) || (to && !isDate(to)) || (from && to && from > to)) return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const { supabase, store } = workspace;

  const [connectionResult, configResult] = await Promise.all([
    supabase.from("data_connections").select("status,external_account_name,last_verified_at,last_error").eq("store_id", store.id).eq("provider", "gohighlevel").maybeSingle(),
    supabase.from("gohighlevel_reporting_configs").select("source_type,selection_id,selection_name,metric_label,updated_at").eq("store_id", store.id).maybeSingle(),
  ]);
  if (connectionResult.error || configResult.error) return NextResponse.json({ error: connectionResult.error?.message ?? configResult.error?.message }, { status: 500 });

  let leadsQuery = supabase.from("gohighlevel_leads_daily").select("metric_date,lead_count,metric_label,selection_id").eq("store_id", store.id).order("metric_date");
  let metaQuery = supabase.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).order("date_start");
  let googleQuery = supabase.from("google_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).order("insight_date");
  if (from) { leadsQuery = leadsQuery.gte("metric_date", from); metaQuery = metaQuery.gte("date_start", from); googleQuery = googleQuery.gte("insight_date", from); }
  if (to) { leadsQuery = leadsQuery.lte("metric_date", to); metaQuery = metaQuery.lte("date_start", to); googleQuery = googleQuery.lte("insight_date", to); }
  const [leadsResult, metaResult, googleResult] = await Promise.all([leadsQuery, metaQuery, googleQuery]);
  if (leadsResult.error || metaResult.error || googleResult.error) return NextResponse.json({ error: leadsResult.error?.message ?? metaResult.error?.message ?? googleResult.error?.message }, { status: 500 });

  type LeadPoint = { date: string; metaSpend: number; googleSpend: number; conversions: number; stageConversions: Record<string, number> };
  const dates = new Map<string, LeadPoint>();
  const get = (date: string) => dates.get(date) ?? { date, metaSpend: 0, googleSpend: 0, conversions: 0, stageConversions: {} };
  for (const row of metaResult.data ?? []) { if (row.currency === store.currency) { const point = get(row.date_start); point.metaSpend += amount(row.spend); dates.set(row.date_start, point); } }
  for (const row of googleResult.data ?? []) { if (row.currency === store.currency) { const point = get(row.insight_date); point.googleSpend += amount(row.spend); dates.set(row.insight_date, point); } }
  const currentLabel = configResult.data?.metric_label;
  let stageSeries: Array<{ id: string; label: string }> = [];
  if (configResult.data?.source_type === "opportunities") {
    try {
      const parsed = JSON.parse(configResult.data.selection_id ?? "") as { selections?: Array<{ pipelineId?: string; pipelineName?: string; stageId?: string; stageName?: string }> };
      stageSeries = (parsed.selections ?? []).filter((item) => item.pipelineId && item.stageId).map((item) => ({
        id: `stage:${item.pipelineId}:${item.stageId}`,
        label: [item.pipelineName, item.stageName].filter(Boolean).join(" — ") || "Selected stage",
      }));
    } catch { /* Older configs retain their aggregate trend until stages are selected again. */ }
  }
  const stageIds = new Set(stageSeries.map((stage) => stage.id));
  let hasStageSeriesRows = false;
  for (const row of leadsResult.data ?? []) {
    const count = Math.max(0, Math.trunc(amount(row.lead_count)));
    if (row.metric_label?.startsWith("stage:") && row.selection_id === configResult.data?.selection_id && stageIds.has(row.metric_label)) {
      const point = get(row.metric_date);
      point.stageConversions[row.metric_label] = (point.stageConversions[row.metric_label] ?? 0) + count;
      dates.set(row.metric_date, point);
      hasStageSeriesRows = true;
    } else if (!row.metric_label?.startsWith("stage:") && (!currentLabel || row.metric_label === currentLabel)) {
      const point = get(row.metric_date); point.conversions += count; dates.set(row.metric_date, point);
    }
  }
  const points = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
  const metaSpend = points.reduce((sum, point) => sum + point.metaSpend, 0);
  const googleSpend = points.reduce((sum, point) => sum + point.googleSpend, 0);
  const conversions = points.reduce((sum, point) => sum + point.conversions, 0);
  return NextResponse.json({
    currency: store.currency, connection: connectionResult.data, config: configResult.data,
    totals: { metaSpend, googleSpend, totalSpend: metaSpend + googleSpend, conversions, costPerConversion: conversions ? (metaSpend + googleSpend) / conversions : null },
    points,
    stageSeries: hasStageSeriesRows ? stageSeries : [],
  });
}
