"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, BarChart3, CircleDollarSign, RefreshCw, Target, Users } from "lucide-react";
import { LeadRevenueSummary } from "./lead-revenue-summary";
import { fetchCachedJson } from "@/lib/analytics/client-response-cache";

type PipelinePayload = {
  currency?: string;
  connection?: { name: string | null; status: string };
  pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position: number }> }>;
  pipelineId?: string;
  pipelineName?: string;
  funnelStages?: { leadStageId: string; bookedCallStageId: string; purchaseStageId: string };
  journeyCounts?: { leads: number; bookedCalls: number; purchases: number };
  averageOrderValue?: number | null;
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
  const [savingFunnel, setSavingFunnel] = useState(false);
  const [funnelStages, setFunnelStages] = useState({ leadStageId: "", bookedCallStageId: "", purchaseStageId: "" });
  const [error, setError] = useState("");
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (pipelineId) params.set("pipelineId", pipelineId);
      const url = `/api/analytics/leads/pipeline?${params}`;
      const payload = await fetchCachedJson<PipelinePayload>(url, { force });
      setData(payload);
      if (payload.pipelineId && payload.pipelineId !== pipelineId) setPipelineId(payload.pipelineId);
      if (payload.funnelStages) setFunnelStages(payload.funnelStages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the sales pipeline");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, pipelineId]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

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

  const saveFunnelStages = async () => {
    const stages = data?.stages ?? [];
    const orderedPositions = [funnelStages.leadStageId, funnelStages.bookedCallStageId, funnelStages.purchaseStageId]
      .map((id) => stages.find((stage) => stage.id === id)?.position ?? -1);
    if (orderedPositions.some((position, index) => position < 0 || (index > 0 && position <= orderedPositions[index - 1]))) {
      setError("Choose three different stages in pipeline order: lead, booked call, then purchase.");
      return;
    }
    setSavingFunnel(true);
    setError("");
    try {
      const response = await fetch("/api/analytics/leads/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnelStages }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save the funnel stages");
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the funnel stages");
    } finally {
      setSavingFunnel(false);
    }
  };

  const format = useMemo(() => new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: data?.currency || "GBP",
    maximumFractionDigits: 0,
  }), [data?.currency]);
  const totals = data?.totals;
  const currency = (value: number | null | undefined) => value == null ? "—" : format.format(value);
  const journeyCounts = data?.journeyCounts ?? { leads: 0, bookedCalls: 0, purchases: 0 };
  const funnelRows = [
    { key: "leads", label: "Leads", stageId: funnelStages.leadStageId, count: journeyCounts.leads },
    { key: "bookedCalls", label: "Booked calls", stageId: funnelStages.bookedCallStageId, count: journeyCounts.bookedCalls },
    { key: "purchases", label: "Purchases / closes", stageId: funnelStages.purchaseStageId, count: journeyCounts.purchases },
  ];
  const maxJourneyCount = Math.max(1, journeyCounts.leads);
  const aov = data?.averageOrderValue ?? 0;
  const estimatedRevenue = journeyCounts.purchases * aov;
  const earningsPerLead = journeyCounts.leads > 0 && aov > 0 ? estimatedRevenue / journeyCounts.leads : null;
  const leadToBookedRate = journeyCounts.leads > 0 ? journeyCounts.bookedCalls / journeyCounts.leads : null;
  const bookedToPurchaseRate = journeyCounts.bookedCalls > 0 ? journeyCounts.purchases / journeyCounts.bookedCalls : null;
  const leadToPurchaseRate = journeyCounts.leads > 0 ? journeyCounts.purchases / journeyCounts.leads : null;

  return <section className="lead-overview">
    <LeadRevenueSummary from={range.from} to={range.to}/>
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
        <button className="filter-button" onClick={() => void load(true)} disabled={loading || savingPipeline}><RefreshCw className={loading ? "spin" : ""}/>{savingPipeline ? "Saving…" : loading ? "Loading…" : "Refresh"}</button>
      </div>
    </div>

    {error && <div className="connection-error" role="alert">{error}</div>}
    {!loading && !data?.connection && <div className="connection-notice"><CircleDollarSign/><div><strong>Connect GoHighLevel to see your sales journey</strong><span>Pipeline stages and opportunity performance will appear here after the location is connected.</span></div><button className="primary" onClick={onOpenConnections}>Open Connections</button></div>}
    {!loading && data?.connection && !data.pipelineId && <div className="connection-notice"><Target/><div><strong>No sales pipeline found</strong><span>This GoHighLevel location does not currently have a pipeline available.</span></div><button className="primary" onClick={onOpenLeads}>Lead reporting settings</button></div>}

    {!loading && data?.pipelineId && <section className="panel lead-funnel-config"><div><span className="eyebrow">FUNNEL STAGE MAPPING</span><p>Choose the GHL stage that represents each milestone. Later-stage opportunities count as having reached earlier milestones.</p></div><div className="lead-funnel-selects">{(["leadStageId", "bookedCallStageId", "purchaseStageId"] as const).map((key, index) => <label key={key}>{["Lead stage", "Booked call stage", "Purchase stage"][index]}<select value={funnelStages[key]} disabled={savingFunnel || savingPipeline} onChange={(event) => setFunnelStages((current) => ({ ...current, [key]: event.target.value }))}><option value="">Choose a stage</option>{(data.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>)}</div><button className="primary" disabled={savingFunnel || !funnelStages.leadStageId || !funnelStages.bookedCallStageId || !funnelStages.purchaseStageId} onClick={() => void saveFunnelStages()}>{savingFunnel ? "Saving…" : "Save funnel"}</button></section>}

    {loading && <div className="panel lead-overview-loading"><RefreshCw className="spin"/><strong>Loading your GoHighLevel sales pipeline…</strong></div>}
    {!loading && data?.pipelineId && totals && <>
      <div className="lead-overview-kpis">
        <article className="metric-card lead-kpi-spend"><div className="metric-label"><i className="lead-kpi-dot meta"/>Meta ad spend</div><strong>{currency(totals.metaSpend)}</strong><div className="metric-foot">{range.label}</div></article>
        <article className="metric-card lead-kpi-spend"><div className="metric-label"><i className="lead-kpi-dot google"/>Google ad spend</div><strong>{currency(totals.googleSpend)}</strong><div className="metric-foot">{range.label}</div></article>
        <article className="metric-card"><div className="metric-label">Leads</div><strong>{journeyCounts.leads.toLocaleString("en-GB")}</strong><div className="metric-foot">{funnelRows[0].label} milestone reached</div></article>
        <article className="metric-card"><div className="metric-label">Booked calls</div><strong>{journeyCounts.bookedCalls.toLocaleString("en-GB")}</strong><div className="metric-foot">{leadToBookedRate == null ? "—" : `${(leadToBookedRate * 100).toFixed(1)}%`} of leads</div></article>
        <article className="metric-card"><div className="metric-label">Purchases / closes</div><strong>{journeyCounts.purchases.toLocaleString("en-GB")}</strong><div className="metric-foot">{leadToPurchaseRate == null ? "—" : `${(leadToPurchaseRate * 100).toFixed(1)}%`} lead close rate</div></article>
        <article className="metric-card"><div className="metric-label">Cost per lead</div><strong>{journeyCounts.leads ? currency(totals.totalSpend / journeyCounts.leads) : "—"}</strong><div className="metric-foot">Selected-period ad spend ÷ leads</div></article>
        <article className="metric-card"><div className="metric-label">Earnings per lead</div><strong>{currency(earningsPerLead)}</strong><div className="metric-foot">Estimated using {currency(aov)} average purchase value</div></article>
        <article className="metric-card"><div className="metric-label">Estimated revenue</div><strong>{aov > 0 ? currency(estimatedRevenue) : "—"}</strong><div className="metric-foot">{aov > 0 ? `${journeyCounts.purchases} purchases × ${currency(aov)} AOV` : "Set an average purchase value in Settings"}</div></article>
      </div>

      <section className="panel lead-funnel-panel">
        <div className="panel-head lead-funnel-heading"><div><span className="eyebrow">GOHIGHLEVEL SALES JOURNEY</span><h3>{data.pipelineName} funnel</h3><p>Milestone totals include opportunities in that stage and any later stage, so volumes and conversion rates follow the sales journey.</p></div><span className="lead-pipeline-total"><Users/>{totals.totalCount.toLocaleString("en-GB")} opportunities reviewed</span></div>
        <div className="lead-funnel-list">
          {funnelRows.map((row, index) => {
            const prior = index ? funnelRows[index - 1].count : null;
            const lost = prior === null ? null : Math.max(0, prior - row.count);
            const conversion = prior ? row.count / prior : index === 0 && row.count ? 1 : null;
            const stage = data.stages?.find((item) => item.id === row.stageId);
            const stageCost = row.count ? totals.totalSpend / row.count : null;
            return <article className="lead-funnel-row" key={row.key}>
              <div className="lead-funnel-step"><span>{String(index + 1).padStart(2, "0")}</span><b>{row.label}</b><small>{stage?.name ?? "Choose a GHL stage"}</small></div>
              <div className="lead-funnel-bar-track"><span style={{ width: `${Math.max(row.count ? 2 : 0, row.count / maxJourneyCount * 100)}%` }}/></div>
              <div className="lead-funnel-count"><strong>{row.count.toLocaleString("en-GB")}</strong><small>{journeyCounts.leads ? `${(row.count / journeyCounts.leads * 100).toFixed(1)}% of leads` : "no opportunities"}</small></div>
              <div className={index === 0 ? "lead-funnel-drop first" : "lead-funnel-drop"}>
                {index === 0 ? <span>Funnel entry</span> : <><ArrowDownRight/><span>{lost!.toLocaleString("en-GB")} drop-off<br/><small>{conversion == null ? "—" : `${(conversion * 100).toFixed(1)}% conversion`}</small></span></>}
              </div>
              <div className="lead-funnel-cost"><small>Cost / event</small><strong>{currency(stageCost)}</strong></div>
              <div className="lead-funnel-value"><small>{index === 2 ? "Est. sales value" : "Pipeline value"}</small><strong>{index === 2 && aov > 0 ? currency(row.count * aov) : currency(stage?.pipelineValue)}</strong></div>
            </article>;
          })}
        </div>
        {!data.stages?.length && <div className="lead-funnel-empty"><BarChart3/><strong>This pipeline has no stages to report</strong></div>}
        <p className="lead-funnel-footnote">Counts show opportunities that have reached each selected milestone, inferred from their current GHL stage. Spend is for the selected reporting period. Estimated sales and earnings use the average purchase value saved in Settings.</p>
      </section>

      <div className="lead-overview-bottom">
        <article className="panel lead-overview-stat"><span className="eyebrow">PIPELINE VALUE</span><strong>{currency(totals.openValue)}</strong><p>Potential value across open opportunities in this pipeline.</p></article>
        <article className="panel lead-overview-stat"><span className="eyebrow">LEAD-TO-BOOKED</span><strong>{leadToBookedRate == null ? "—" : `${(leadToBookedRate * 100).toFixed(1)}%`}</strong><p>Booked call rate from lead milestone.</p></article>
        <article className="panel lead-overview-stat"><span className="eyebrow">BOOKED-TO-PURCHASE</span><strong>{bookedToPurchaseRate == null ? "—" : `${(bookedToPurchaseRate * 100).toFixed(1)}%`}</strong><p>Close rate from booked calls. {totals.lostCount.toLocaleString("en-GB")} opportunities marked lost.</p></article>
      </div>
    </>}
  </section>;
}
