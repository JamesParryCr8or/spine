"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, CircleDollarSign, RefreshCw, Target, Users } from "lucide-react";

type PipelinePayload = {
  currency?: string;\n  connection?: { name: string | null; status: string };
  pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position: number }> }>;
  pipelineId?: string;
  pipelineName?: string;
  stages?: Array<{ id: string; name: string; position: number; count: number; pipelineValue: number }>;
  totals?: { openCount: number; wonCount: number; lostCount: number; totalCount: number; openValue: number; wonValue: number; averageWonValue: number | null; winRate: number | null; metaSpend: number; googleSpend: number; totalSpend: number };
  error?: string;
  sourceNote?: string;
};

type LeadOverviewProps = {
  range: { from: string; to: string; label: string };
  onOpenConnections: () => void;
  onOpenLeads: () => void;
};

export function LeadOverview({ range, onOpenConnections, onOpenLeads }: LeadOverviewProps) {
  const [data, setData] = useState<PipelinePayload | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (pipelineId) params.set("pipelineId", pipelineId);
      const response = await fetch(`/api/analytics/leads/pipeline?${params}`, { cache: "no-store" });
      const payload = await response.json() as PipelinePayload;
      if (!response.ok) throw new Error(payload.error || "Could not load this GoHighLevel pipeline");
      setData(payload);
      if (payload.pipelineId && payload.pipelineId !== pipelineId) setPipelineId(payload.pipelineId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the sales pipeline");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, pipelineId]);
  useEffect(() => { void load(); }, [load]);

  const changePipeline = async (nextPipelineId: string) => {
    if (!nextPipelineId || nextPipelineId === pipelineId) return;
    setSavingPipeline(true);
    setError("");
    try {
      const response = await fetch("/api/analytics/leads/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId: nextPipelineId }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save the default pipeline");
      setPipelineId(nextPipelineId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the default pipeline");
    } finally {
      setSavingPipeline(false);
    }
  };

  const format = useMemo(() => new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: data?.currency || "GBP",
    maximumFractionDigits: 0,
  }), [data?.currency]);
  const totals = data?.totals;
  const maxStageCount = Math.max(1, ...(data?.stages ?? []).map((stage) => stage.count));
  const stageValues = data?.stages ?? [];
  const firstStageCount = stageValues[0]?.count ?? 0;
  const currency = (value: number | null | undefined) => value == null ? "—" : format.format(value);

  return <section className="lead-overview">
    <div className="lead-overview-heading">
      <div>
        <span className="eyebrow">GOHIGHLEVEL SALES JOURNEY</span>
        <h2>{data?.pipelineName || "Sales pipeline overview"}</h2>
        <p>Pipeline stage volumes, drop-off and paid-media cost per stage for {range.label.toLowerCase()} spend.</p>
      </div>
      <div className="lead-overview-actions">
        <label>Sales pipeline
          <select aria-label="Choose default GoHighLevel pipeline" value={pipelineId || data?.pipelineId || ""} disabled={loading || savingPipeline || !(data?.pipelines?.length)} onChange={(event) => void changePipeline(event.target.value)}>
            {(data?.pipelines ?? []).map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
          </select>
        </label>
        <button className="filter-button" onClick={() => void load()} disabled={loading || savingPipeline}><RefreshCw className={loading ? "spin" : ""}/>{savingPipeline ? "Saving…" : loading ? "Loading…" : "Refresh"}</button>
      </div>
    </div>

    {error && <div className="connection-error" role="alert">{error}</div>}
    {!loading && !data?.connection && <div className="connection-notice"><CircleDollarSign/><div><strong>Connect GoHighLevel to see your sales journey</strong><span>Pipeline stages and opportunity performance will appear here after the location is connected.</span></div><button className="primary" onClick={onOpenConnections}>Open Connections</button></div>}
    {!loading && data?.connection && !data.pipelineId && <div className="connection-notice"><Target/><div><strong>No sales pipeline found</strong><span>This GoHighLevel location does not currently have a pipeline available.</span></div><button className="primary" onClick={onOpenLeads}>Lead reporting settings</button></div>}

    {loading && <div className="panel lead-overview-loading"><RefreshCw className="spin"/><strong>Loading your GoHighLevel sales pipeline…</strong></div>}
    {!loading && data?.pipelineId && totals && <>
      <div className="lead-overview-kpis">
        <article className="metric-card lead-kpi-spend"><div className="metric-label"><i className="lead-kpi-dot meta"/>Meta ad spend</div><strong>{currency(totals.metaSpend)}</strong><div className="metric-foot">{range.label}</div></article>
        <article className="metric-card lead-kpi-spend"><div className="metric-label"><i className="lead-kpi-dot google"/>Google ad spend</div><strong>{currency(totals.googleSpend)}</strong><div className="metric-foot">{range.label}</div></article>
        <article className="metric-card"><div className="metric-label">Open opportunities</div><strong>{totals.openCount.toLocaleString("en-GB")}</strong><div className="metric-foot">{currency(totals.openValue)} open pipeline value</div></article>
        <article className="metric-card"><div className="metric-label">Won deals</div><strong>{totals.wonCount.toLocaleString("en-GB")}</strong><div className="metric-foot">{currency(totals.wonValue)} won value</div></article>
        <article className="metric-card"><div className="metric-label">Win rate</div><strong>{totals.winRate == null ? "—" : `${(totals.winRate * 100).toFixed(1)}%`}</strong><div className="metric-foot">Won ÷ won and lost opportunities</div></article>
        <article className="metric-card"><div className="metric-label">Cost per first-stage opportunity</div><strong>{stageValues[0]?.count ? currency(totals.totalSpend / stageValues[0].count) : "—"}</strong><div className="metric-foot">{stageValues[0]?.count ?? 0} in “{stageValues[0]?.name ?? "first stage"}”</div></article>
      </div>

      <section className="panel lead-funnel-panel">
        <div className="panel-head lead-funnel-heading"><div><span className="eyebrow">LIVE PIPELINE SNAPSHOT</span><h3>{data.pipelineName} stage journey</h3><p>Each bar shows opportunities currently in that stage. Cost per stage divides selected-period Meta and Google spend by the stage volume.</p></div><span className="lead-pipeline-total"><Users/>{totals.totalCount.toLocaleString("en-GB")} opportunities</span></div>
        <div className="lead-funnel-list">
          {stageValues.map((stage, index) => {
            const prior = index ? stageValues[index - 1].count : null;
            const delta = prior === null ? null : prior - stage.count;
            const stageCost = stage.count ? totals.totalSpend / stage.count : null;
            const progress = firstStageCount ? Math.min(100, stage.count / firstStageCount * 100) : 0;
            return <article className="lead-funnel-row" key={stage.id}>
              <div className="lead-funnel-step"><span>{String(index + 1).padStart(2, "0")}</span><b>{stage.name}</b></div>
              <div className="lead-funnel-bar-track"><span style={{ width: `${Math.max(stage.count ? 2 : 0, stage.count / maxStageCount * 100)}%` }}/></div>
              <div className="lead-funnel-count"><strong>{stage.count.toLocaleString("en-GB")}</strong><small>{firstStageCount ? `${progress.toFixed(0)}% of first stage` : "no opportunities"}</small></div>
              <div className={delta === null ? "lead-funnel-drop first" : delta > 0 ? "lead-funnel-drop" : "lead-funnel-drop gain"}>
                {delta === null ? <span>Entry stage</span> : delta > 0 ? <><ArrowDownRight/><span>{delta.toLocaleString("en-GB")} fewer<br/><small>{prior ? `${(delta / prior * 100).toFixed(1)}% drop-off` : "—"}</small></span></> : <><ArrowUpRight/><span>{Math.abs(delta).toLocaleString("en-GB")} more<br/><small>vs previous stage</small></span></>}
              </div>
              <div className="lead-funnel-cost"><small>Cost / stage</small><strong>{currency(stageCost)}</strong></div>
              <div className="lead-funnel-value"><small>Pipeline value</small><strong>{currency(stage.pipelineValue)}</strong></div>
            </article>;
          })}
        </div>
        {!stageValues.length && <div className="lead-funnel-empty"><BarChart3/><strong>This pipeline has no stages to report</strong></div>}
        <p className="lead-funnel-footnote">Stage counts are a live snapshot of current opportunities, not a historical stage-transition cohort. Cost per stage is blended paid-media spend divided by the current volume in that stage.</p>
      </section>

      <div className="lead-overview-bottom">
        <article className="panel lead-overview-stat"><span className="eyebrow">PIPELINE VALUE</span><strong>{currency(totals.openValue)}</strong><p>Potential value across open opportunities in this pipeline.</p></article>
        <article className="panel lead-overview-stat"><span className="eyebrow">AVERAGE WON DEAL</span><strong>{currency(totals.averageWonValue)}</strong><p>Average monetary value of won opportunities.</p></article>
        <article className="panel lead-overview-stat"><span className="eyebrow">LOST OPPORTUNITIES</span><strong>{totals.lostCount.toLocaleString("en-GB")}</strong><p>Marked lost or abandoned in GoHighLevel.</p></article>
      </div>
    </>}
  </section>;
}
