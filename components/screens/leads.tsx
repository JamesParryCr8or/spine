"use client";

import { useCallback, useEffect, useState } from "react";
import { type ReportingGranularity } from "@/lib/analytics/reporting-periods";
import { fetchCachedJson } from "@/lib/analytics/client-response-cache";
import { BarChart3, Info, RefreshCw, X } from "lucide-react";
import { type FinanceDatePreset } from "@/components/analytics/shared";

type LeadDashboardData = {
  currency: string;
  connection: { status: string; external_account_name: string | null } | null;
  config: { source_type: "contacts" | "opportunities"; metric_label: string; selection_name: string | null } | null;
  totals: { metaSpend: number; googleSpend: number; bingSpend: number; totalSpend: number; conversions: number; costPerConversion: number | null };
  stageSeries: Array<{ id: string; label: string }>;
  points: Array<{ date: string; metaSpend: number; googleSpend: number; bingSpend: number; conversions: number; stageConversions?: Record<string, number> }>;
};

function groupLeadPoints(points: LeadDashboardData["points"], granularity: ReportingGranularity) {
  if (granularity === "daily") return points;
  const grouped = new Map<string, LeadDashboardData["points"][number]>();
  for (const point of points) {
    const date = new Date(`${point.date}T00:00:00Z`);
    let key = point.date;
    if (granularity === "weekly") { const start = new Date(date); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); key = start.toISOString().slice(0, 10); }
    if (granularity === "monthly") key = `${point.date.slice(0, 7)}-01`;
    if (granularity === "quarterly") key = `${point.date.slice(0, 4)}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    if (granularity === "annual") key = point.date.slice(0, 4);
    const current = grouped.get(key) ?? { date: key, metaSpend: 0, googleSpend: 0, bingSpend: 0, conversions: 0, stageConversions: {} };
    current.metaSpend += point.metaSpend; current.googleSpend += point.googleSpend; current.bingSpend += point.bingSpend; current.conversions += point.conversions; grouped.set(key, current);
    for (const [stageId, count] of Object.entries(point.stageConversions ?? {})) {
      current.stageConversions![stageId] = (current.stageConversions![stageId] ?? 0) + count;
    }
  }
  return [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function LeadPerformanceChart({ points, currency, label, stageSeries }: { points: LeadDashboardData["points"]; currency: string; label: string; stageSeries: LeadDashboardData["stageSeries"] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 860, height = 300, left = 54, right = 64, top = 18, bottom = 42;
  const spend = points.map((point) => point.metaSpend + point.googleSpend + point.bingSpend);
  const maxSpend = Math.max(1, ...spend);
  const lines = (stageSeries.length ? stageSeries : [{ id: "aggregate", label: `Cost per ${label.toLowerCase()}` }]).map((series) => ({
    ...series,
    color: ["#14b87a", "#e16b42", "#8c62d9", "#d3a21b", "#258fc0", "#db5c83"][stageSeries.findIndex((item) => item.id === series.id) % 6] || "#14b87a",
    values: points.map((point) => {
      const conversions = series.id === "aggregate" ? point.conversions : point.stageConversions?.[series.id] ?? 0;
      return conversions > 0 ? (point.metaSpend + point.googleSpend + point.bingSpend) / conversions : null;
    }),
  }));
  const maxCost = Math.max(1, ...lines.flatMap((line) => line.values.filter((value): value is number => value !== null)));
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const pointWidth = chartWidth / Math.max(points.length, 1);
  const x = (index: number) => left + pointWidth * (index + .5);
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const costY = (value: number) => top + chartHeight - (value / maxCost) * chartHeight;
  const format = new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 });
  const selected = hovered === null ? null : points[hovered];
  const lineSegments = lines.map((line) => {
    const segments: string[] = []; let segment: string[] = [];
    line.values.forEach((value, index) => {
      if (value === null) { if (segment.length) segments.push(segment.join(" ")); segment = []; }
      else segment.push(`${x(index)},${costY(value)}`);
    });
    if (segment.length) segments.push(segment.join(" "));
    return { ...line, segments };
  });
  const ticks = [0, .25, .5, .75, 1];
  return <div className="lead-chart-wrap">
    <div className="lead-chart-legend"><span><i className="lead-key meta"/>Meta spend</span><span><i className="lead-key google"/>Google spend</span><span><i className="lead-key microsoft"/>Microsoft spend</span>{lines.map((line) => <span key={line.id}><i className="lead-key result" style={{ backgroundColor: line.color }}/>{stageSeries.length ? line.label : `Cost per ${label.toLowerCase()}`}</span>)}</div>
    <div className="lead-chart" role="img" aria-label={`Marketing spend and cost per selected ${label}s across the selected reporting period`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {ticks.map((tick) => { const y = top + chartHeight - tick * chartHeight; return <g key={tick}><line className="lead-gridline" x1={left} x2={width-right} y1={y} y2={y}/><text className="lead-axis-label" x={left-10} y={y+4} textAnchor="end">{format.format(maxSpend*tick)}</text><text className="lead-axis-label" x={width-right+10} y={y+4}>{format.format(maxCost*tick)}</text></g>; })}
        <line className="lead-axis" x1={left} x2={width-right} y1={top+chartHeight} y2={top+chartHeight}/>
        {points.map((point, index) => { const barWidth = Math.max(1, Math.min(34, pointWidth * .64)); const googleH = (point.googleSpend/maxSpend)*chartHeight; const bingH = (point.bingSpend/maxSpend)*chartHeight; const metaH = (point.metaSpend/maxSpend)*chartHeight; const base = top+chartHeight; return <g key={point.date} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} className="lead-chart-point"><rect className="lead-hover-target" x={x(index)-pointWidth/2} y={top} width={pointWidth} height={chartHeight}/><rect className="lead-google-bar" x={x(index)-barWidth/2} y={base-googleH} width={barWidth} height={googleH}/><rect className="lead-bing-bar" x={x(index)-barWidth/2} y={base-googleH-bingH} width={barWidth} height={bingH}/><rect className="lead-meta-bar" x={x(index)-barWidth/2} y={base-googleH-bingH-metaH} width={barWidth} height={metaH}/><text className="lead-x-label" x={x(index)} y={height-14} textAnchor="middle">{(index % labelEvery === 0 || index === points.length - 1) ? point.date.slice(5) : ""}</text></g>; })}
        {lineSegments.flatMap((line) => line.segments.map((segmentPoints, index) => <polyline key={`${line.id}-${index}`} className="lead-results-line" points={segmentPoints} style={{ stroke: line.color }}/>))}
        {lineSegments.flatMap((line) => line.values.map((value, index) => value === null ? null : <circle key={`${line.id}-${points[index].date}`} className={`lead-result-dot${hovered === index ? " active" : ""}`} cx={x(index)} cy={costY(value)} r={hovered === index ? "5" : "3"} style={{ stroke: line.color, ...(hovered === index ? { fill: line.color } : {}) }}/>))}
        <text className="lead-axis-title" x={left} y={12}>Spend</text><text className="lead-axis-title" x={width-right} y={12} textAnchor="end">Cost / event</text>
      </svg>
      {selected && <div className="lead-tooltip" style={{ left: `${Math.max(12, Math.min(88, ((x(hovered!) - left) / chartWidth) * 100))}%` }}><strong>{selected.date}</strong><span>Meta: {format.format(selected.metaSpend)}</span><span>Google: {format.format(selected.googleSpend)}</span><span>Microsoft: {format.format(selected.bingSpend)}</span><span>Spend: {format.format(selected.metaSpend+selected.googleSpend+selected.bingSpend)}</span><b>{selected.conversions.toLocaleString("en-GB")} selected events</b>{lineSegments.map((line) => { const count = line.id === "aggregate" ? selected.conversions : selected.stageConversions?.[line.id] ?? 0; const value = line.values[hovered!]; return <b key={line.id} style={{ color: line.color }}>{line.id === "aggregate" ? `Cost per ${label.toLowerCase()}` : line.label}: {count} · {value === null ? "—" : format.format(value)}</b>; })}</div>}
    </div>
  </div>;
}

export function Leads({ onOpenConnections, range, onRangeChange }: { onOpenConnections: () => void; range: { from: string; to: string; label: string; preset: FinanceDatePreset }; onRangeChange: (next: Partial<{ preset: FinanceDatePreset; from: string; to: string }>) => void }) {
  const [data, setData] = useState<LeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choosingStage, setChoosingStage] = useState(false);
  const [syncingOpportunities, setSyncingOpportunities] = useState(false);
  const [stagePicker, setStagePicker] = useState<Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position?: number }> }> | null>(null);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [includeLaterStages, setIncludeLaterStages] = useState(true);
  const [granularity, setGranularity] = useState<ReportingGranularity>("daily");
  const load = useCallback(async (force = false) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams(); if (range.from) params.set("from", range.from); if (range.to) params.set("to", range.to);
      const url = `/api/analytics/leads${params.size ? `?${params}` : ""}`;
      const payload = await fetchCachedJson<LeadDashboardData>(url, { force });
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load lead performance"); }
    finally { setLoading(false); }
  }, [range.from, range.to]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timeout); }, [load]);
  const syncOpportunities = async () => {
    setSyncingOpportunities(true); setError("");
    try {
      const response = await fetch("/api/connections/gohighlevel/sync", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not sync GoHighLevel opportunities");
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sync GoHighLevel opportunities");
    } finally {
      setSyncingOpportunities(false);
    }
  };
  const choosePipelineStage = async () => {
    setChoosingStage(true); setError("");
    try { const response = await fetch("/api/connections/gohighlevel/pipelines"); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Could not load GoHighLevel pipelines"); setStagePicker(payload.pipelines ?? []); setSelectedStageIds([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load GoHighLevel pipelines"); } finally { setChoosingStage(false); }
  };
  const savePipelineStages = async () => {
    const selected = (stagePicker ?? []).flatMap((pipeline) => pipeline.stages.map((stage) => ({ pipeline, stage }))).filter(({ stage }) => selectedStageIds.includes(stage.id));
    if (!selected.length) { setError("Choose at least one pipeline stage"); return; }
    setChoosingStage(true); setError("");
    try { const response = await fetch("/api/connections/gohighlevel", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selections: selected.map(({ pipeline, stage }) => ({ pipelineId: pipeline.id, pipelineName: pipeline.name, stageId: stage.id, stageName: stage.name, position: stage.position ?? 0 })), includeLaterStages }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Could not save the selected stages"); setStagePicker(null); await syncOpportunities(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the selected stages"); } finally { setChoosingStage(false); }
  };
  const format = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const configLabel = data?.config?.metric_label || "conversion";
  const groupedPoints = groupLeadPoints(data?.points ?? [], granularity);
  const chartPoints = groupedPoints;
  const bestPoint = chartPoints.reduce<LeadDashboardData["points"][number] | null>((best, point) => !best || point.conversions > best.conversions ? point : best, null);
  return <section className="leads-dashboard">
    <div className="lead-dashboard-heading"><div><span className="eyebrow">LEAD GENERATION</span><h2>Lead performance</h2><p>Marketing cost against the GoHighLevel result selected for this account. Reporting period: {range.label}.</p></div><button className="filter-button" onClick={() => data?.config?.source_type === "opportunities" ? void syncOpportunities() : void load()} disabled={loading || syncingOpportunities}><RefreshCw className={loading || syncingOpportunities ? "spin" : ""}/>{syncingOpportunities ? "Syncing opportunities…" : loading ? "Refreshing" : "Refresh"}</button></div>
    <section className="filter-row pnl-period finance-date-controls lead-date-controls"><label>Period<select aria-label="Lead reporting period" value={range.preset} onChange={(event) => onRangeChange({ preset: event.target.value as FinanceDatePreset })}><option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option></select></label><label>From<input type="date" value={range.from} onChange={(event) => onRangeChange({ preset: "custom", from: event.target.value })}/></label><label>To<input type="date" value={range.to} onChange={(event) => onRangeChange({ preset: "custom", to: event.target.value })}/></label><label>Group by<select aria-label="Lead trend granularity" value={granularity} onChange={(event) => setGranularity(event.target.value as ReportingGranularity)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label></section>
    {error ? <div className="connection-error" role="alert">{error}</div> : null}
    {!loading && !data?.connection ? <div className="connection-notice"><Info/><div><strong>Connect GoHighLevel to start lead reporting</strong><span>Choose contacts or pipeline opportunities, then Spine can calculate cost per result.</span></div><button className="primary" onClick={onOpenConnections}>Open Connections</button></div> : null}
    <div className="metric-grid">
      <article className="metric-card"><div className="metric-label">Meta cost</div><strong>{format.format(data?.totals.metaSpend ?? 0)}</strong><div className="metric-foot">Imported Meta Ads spend</div></article>
      <article className="metric-card"><div className="metric-label">Google cost</div><strong>{format.format(data?.totals.googleSpend ?? 0)}</strong><div className="metric-foot">Imported Google Ads spend</div></article>
      <article className="metric-card"><div className="metric-label">Microsoft cost</div><strong>{format.format(data?.totals.bingSpend ?? 0)}</strong><div className="metric-foot">Imported Microsoft Ads spend</div></article>
      <article className="metric-card"><div className="metric-label">Total marketing cost</div><strong>{format.format(data?.totals.totalSpend ?? 0)}</strong><div className="metric-foot">Meta + Google + Microsoft</div></article>
      <article className="metric-card"><div className="metric-label">Cost per event</div><strong>{data?.totals.costPerConversion === null || data?.totals.costPerConversion === undefined ? "—" : format.format(data.totals.costPerConversion)}</strong><div className="metric-foot">{data?.totals.conversions ?? 0} {configLabel}{(data?.totals.conversions ?? 0) === 1 ? "" : "s"} imported</div></article>
    </div>
    <section className="panel lead-trend-panel"><div className="panel-head"><div><span className="eyebrow">TREND</span><h3>Spend and selected-stage events</h3><p className="lead-chart-description">Paid-media spend on the left axis and cost per selected GoHighLevel stage on the right. Choose day, week or month grouping above.</p></div><div className="lead-selection"><span>{data?.config?.selection_name || data?.connection?.external_account_name || "GoHighLevel"}</span>{data?.connection && <button className="filter-button" onClick={() => void choosePipelineStage()} disabled={choosingStage}>{choosingStage ? "Loading…" : "Choose pipeline stage"}</button>}</div></div>{loading ? <div className="cost-empty"><RefreshCw className="spin"/><strong>Loading lead performance…</strong></div> : chartPoints.length ? <LeadPerformanceChart points={chartPoints} currency={data?.currency || "GBP"} label={configLabel} stageSeries={data?.stageSeries ?? []} /> : <div className="cost-empty"><BarChart3/><strong>No reporting data has been imported yet</strong><span>Your GoHighLevel connection is saved. Choose a pipeline stage above, then refresh to import its opportunity events.</span></div>}</section>
    {!loading && chartPoints.length ? <section className="panel lead-event-table"><div className="panel-head"><div><span className="eyebrow">SELECTED STAGE</span><h3>{configLabel} events and cost</h3><p>Current opportunities in the selected stage, plus later stages if enabled, grouped by GoHighLevel’s last stage-change date. Records without that date use their created date.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Period</th><th>Meta spend</th><th>Google spend</th><th>Microsoft spend</th><th>Total spend</th><th>Selected-stage events</th><th>Cost per event</th></tr></thead><tbody>{chartPoints.map((point) => { const spend = point.metaSpend + point.googleSpend + point.bingSpend; return <tr key={point.date}><td>{point.date}</td><td>{format.format(point.metaSpend)}</td><td>{format.format(point.googleSpend)}</td><td>{format.format(point.bingSpend)}</td><td><strong>{format.format(spend)}</strong></td><td>{point.conversions.toLocaleString("en-GB")}</td><td>{point.conversions ? format.format(spend / point.conversions) : "—"}</td></tr>; })}</tbody></table></div></section> : null}
    {!loading && chartPoints.length ? <section className="lead-insights-grid">
      <article className="panel lead-insight"><span className="eyebrow">CHANNEL MIX</span><h3>Paid media spend</h3><div className="lead-split"><span style={{width: `${Math.max(0, ((data?.totals.metaSpend ?? 0) / Math.max(1, data?.totals.totalSpend ?? 0))*100)}%`}}/><i style={{width: `${Math.max(0, ((data?.totals.googleSpend ?? 0) / Math.max(1, data?.totals.totalSpend ?? 0))*100)}%`}}/><b style={{width: `${Math.max(0, ((data?.totals.bingSpend ?? 0) / Math.max(1, data?.totals.totalSpend ?? 0))*100)}%`}}/></div><div className="lead-insight-values"><span>Meta <b>{format.format(data?.totals.metaSpend ?? 0)}</b></span><span>Google <b>{format.format(data?.totals.googleSpend ?? 0)}</b></span><span>Microsoft <b>{format.format(data?.totals.bingSpend ?? 0)}</b></span></div></article>
      <article className="panel lead-insight"><span className="eyebrow">EFFICIENCY</span><h3>Cost per result</h3><strong>{data?.totals.costPerConversion == null ? "—" : format.format(data.totals.costPerConversion)}</strong><p>{data?.totals.conversions ?? 0} selected {configLabel}{(data?.totals.conversions ?? 0) === 1 ? "" : "s"} across the current reporting window.</p></article>
      <article className="panel lead-insight"><span className="eyebrow">DAILY SIGNAL</span><h3>Best result day</h3><strong>{bestPoint?.date || "—"}</strong><p>{bestPoint ? `${bestPoint.conversions} ${configLabel}${bestPoint.conversions === 1 ? "" : "s"} recorded.` : "No selected-stage results recorded."}</p></article>
    </section> : null}
    {stagePicker && <div className="modal-backdrop" onMouseDown={() => setStagePicker(null)}><section className="connection-modal lead-stage-picker" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setStagePicker(null)}><X/></button><span className="eyebrow">GOHIGHLEVEL</span><h2>Choose conversion stages</h2><p className="modal-intro">Select one or more stages. Include opportunities that have progressed beyond the selected stage.</p><div className="stage-options">{stagePicker.map((pipeline) => <div key={pipeline.id}><strong>{pipeline.name}</strong>{pipeline.stages.map((stage) => <label key={stage.id} className="stage-option"><input type="checkbox" checked={selectedStageIds.includes(stage.id)} onChange={() => setSelectedStageIds((ids) => ids.includes(stage.id) ? ids.filter((id) => id !== stage.id) : [...ids, stage.id])}/><span>{stage.name}</span></label>)}</div>)}</div><label className="stage-option include-later"><input type="checkbox" checked={includeLaterStages} onChange={(event) => setIncludeLaterStages(event.target.checked)}/><span>Include opportunities that progressed beyond selected stages</span></label><div className="modal-actions"><button onClick={() => setStagePicker(null)}>Cancel</button><button className="primary" disabled={choosingStage || !selectedStageIds.length} onClick={() => void savePipelineStages()}>{choosingStage ? "Saving…" : "Save stages"}</button></div></section></div>}
  </section>;
}
