"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, BarChart3, CalendarClock, CircleDollarSign, RefreshCw, Users } from "lucide-react";

type LeadView = "Pipeline outcomes" | "Stage ageing" | "Lead sources" | "Sales team" | "Forecast" | "Lost reasons" | "Follow-ups";
type Range = { from: string; to: string; label: string };
type Opportunity = {
  id?: string; name?: string; pipelineStageId?: string; status?: string; monetaryValue?: number | string | null;
  source?: string; assignedTo?: string; createdAt?: string; lastStageChangeAt?: string; lastStatusChangeAt?: string;
  forecastExpectedCloseDate?: string; forecastProbability?: number | string; effectiveProbability?: number | string;
  lostReasonId?: string; lostReason?: string; tasks?: unknown[]; calendarEvents?: unknown[];
};
type ReportData = {
  currency?: string; pipelineName?: string; stages?: Array<{ id: string; name: string; position: number }>;
  opportunities?: Opportunity[]; lostReasons?: Array<{ id?: string; name?: string }>;
  followupsAvailable?: boolean; followupsNote?: string;
};
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const date = (v?: string) => v ? new Date(v) : null;
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
const monthLabel = (v: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(v));
const safeDate = (v?: string) => { const d = date(v); return d && !Number.isNaN(d.getTime()) ? d : null; };

export function LeadReportPage({ view, range }: { view: LeadView; range: Range }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    const params = new URLSearchParams({ from: range.from, to: range.to, details: "1" });
    if (view === "Follow-ups") params.set("includeFollowups", "1");
    if (view === "Lost reasons") params.set("includeLostReasons", "1");
    fetch(`/api/analytics/leads/pipeline?${params}`)
      .then(async (r) => { const payload = await r.json(); if (!r.ok) throw new Error(payload.error || "Could not load the GoHighLevel report"); return payload as ReportData; })
      .then((payload) => { if (live) setData(payload); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load this report"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range.from, range.to, view, revision]);

  const fmt = useMemo(() => new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 }), [data?.currency]);
  const count = (n: number) => n.toLocaleString("en-GB");
  const opportunities = data?.opportunities ?? [];
  const stages = data?.stages ?? [];
  const stageById = new Map(stages.map((s) => [s.id, s.name]));
  const now = new Date();
  const formatMoney = (n: number) => fmt.format(n);
  const inRange = (o: Opportunity) => { const created = safeDate(o.createdAt); return !created || ((!range.from || created.toISOString().slice(0,10) >= range.from) && (!range.to || created.toISOString().slice(0,10) <= range.to)); };
  const rows = opportunities.filter(inRange);

  const table = (headers: string[], body: Array<Array<ReactNode>>) => <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{body.length ? body.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>No matching opportunities in this date range.</td></tr>}</tbody></table></div>;
  const bar = (value: number, maximum: number, label: string, color = "#6d5ce8") => {
    const width = maximum > 0 && value > 0 ? Math.max(3, Math.min(100, value / maximum * 100)) : 0;
    return <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(0, maximum)} aria-valuenow={Math.max(0, value)}
      style={{ position: "relative", minWidth: 88, height: 26, overflow: "hidden", borderRadius: 7, background: "#f0eff8", display: "flex", alignItems: "center", padding: "0 8px", boxSizing: "border-box" }}>
      <span aria-hidden="true" style={{ position: "absolute", inset: "0 auto 0 0", width: width + "%", borderRadius: 7, background: `linear-gradient(90deg, ${color}25, ${color}65)`, transition: "width .35s ease" }}/>
      <b style={{ position: "relative", zIndex: 1, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{label}</b>
    </div>;
  };
  const kpi = (label: string, value: string, note: string, Icon: typeof Users) => <article className="metric-card"><div className="metric-label"><Icon/>{label}</div><strong>{value}</strong><div className="metric-foot">{note}</div></article>;

  let content: ReactNode = null;
  if (view === "Pipeline outcomes") {
    const cohorts = new Map<string, { total: number; won: number; lost: number; open: number; value: number }>();
    for (const o of rows) {
      const created = safeDate(o.createdAt); if (!created) continue;
      const key = created.toISOString().slice(0, 7) + "-01";
      const c = cohorts.get(key) ?? { total: 0, won: 0, lost: 0, open: 0, value: 0 };
      c.total++; c.value += num(o.monetaryValue);
      const s = (o.status || "").toLowerCase();
      if (s === "won") c.won++; else if (s === "lost" || s === "abandoned") c.lost++; else c.open++;
      cohorts.set(key, c);
    }
    const list = [...cohorts.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
    const won = rows.filter(o => (o.status || "").toLowerCase() === "won").length;
    const closed = rows.filter(o => ["won","lost","abandoned"].includes((o.status || "").toLowerCase())).length;
    const maxCohortCount = Math.max(1, ...list.map(([, cohort]) => cohort.total));
    const maxWonValue = Math.max(1, ...list.map(([key]) => [...opportunities]
      .filter((o) => safeDate(o.createdAt)?.toISOString().slice(0, 7) === key.slice(0, 7) && (o.status || "").toLowerCase() === "won")
      .reduce((sum, o) => sum + num(o.monetaryValue), 0)));
    content = <>
      <div className="lead-overview-kpis">
        {kpi("Opportunities created", count(rows.length), range.label, Users)}
        {kpi("Won", count(won), "Current status of opportunities created in range", BarChart3)}
        {kpi("Win rate", closed ? ((won / closed) * 100).toFixed(1) + "%" : "—", "Won ÷ won and lost", CircleDollarSign)}
      </div>
      <section className="panel lead-report-panel">
        <div className="panel-head"><div><span className="eyebrow">CREATION COHORTS</span><h3>Outcome by month created</h3><p>Each cohort is grouped by opportunity creation month; statuses reflect the latest GHL snapshot.</p></div></div>
        {table(["Created month", "Opportunities", "Won", "Lost", "Open", "Win rate", "Won value"], list.map(([key, cohort]) => {
          const wonValue = [...opportunities]
            .filter((o) => safeDate(o.createdAt)?.toISOString().slice(0, 7) === key.slice(0, 7) && (o.status || "").toLowerCase() === "won")
            .reduce((sum, o) => sum + num(o.monetaryValue), 0);
          return [
            monthLabel(key),
            bar(cohort.total, maxCohortCount, count(cohort.total)),
            bar(cohort.won, Math.max(1, ...list.map(([, item]) => item.won)), count(cohort.won), "#10a779"),
            bar(cohort.lost, Math.max(1, ...list.map(([, item]) => item.lost)), count(cohort.lost), "#e36b72"),
            bar(cohort.open, Math.max(1, ...list.map(([, item]) => item.open)), count(cohort.open), "#f0a323"),
            cohort.won + cohort.lost ? bar(cohort.won / (cohort.won + cohort.lost) * 100, 100, ((cohort.won / (cohort.won + cohort.lost)) * 100).toFixed(1) + "%", "#10a779") : "—",
            bar(wonValue, maxWonValue, formatMoney(wonValue), "#3186db"),
          ];
        }))}
      </section>
    </>;
  } else if (view === "Stage ageing") {
    const groups = new Map<string, { count:number; value:number; ages:number[]; stale:number }>();
    for (const o of opportunities) {
      const name = stageById.get(o.pipelineStageId || "") || "No current stage";
      const g = groups.get(name) ?? { count:0, value:0, ages:[], stale:0 };
      const entered = safeDate(o.lastStageChangeAt) || safeDate(o.createdAt);
      const age = entered ? daysBetween(entered, now) : null;
      g.count++; g.value += num(o.monetaryValue); if(age !== null){g.ages.push(age); if(age>30)g.stale++;}
      groups.set(name,g);
    }
    const ordered = stages.map(s=>s.name).filter(n=>groups.has(n));
    const names=[...ordered,...[...groups.keys()].filter(n=>!ordered.includes(n))];
    content=<><div className="lead-overview-kpis">{kpi("Open opportunities",count(opportunities.filter(o=>!["won","lost","abandoned"].includes((o.status||"").toLowerCase())).length),"Across the selected pipeline",Users)}{kpi("Over 30 days",count([...groups.values()].reduce((s,g)=>s+g.stale,0)),"Age since last stage change (or created date)",CalendarClock)}{kpi("Pipeline value",formatMoney(opportunities.filter(o=>!["won","lost","abandoned"].includes((o.status||"").toLowerCase())).reduce((s,o)=>s+num(o.monetaryValue),0)),"Open opportunity value",CircleDollarSign)}</div><section className="panel lead-report-panel"><div className="panel-head"><div><span className="eyebrow">CURRENT STAGE AGE</span><h3>Where opportunities are waiting</h3><p>Uses GHL’s latest stage-change timestamp; older records without it use their creation date.</p></div></div>{table(["Stage","Opportunities","Average days","Over 30 days","Pipeline value"],names.map(name=>{const g=groups.get(name)!;const average=g.ages.length?Math.round(g.ages.reduce((a,b)=>a+b,0)/g.ages.length):0;return [name,bar(g.count,Math.max(...[...groups.values()].map(x=>x.count)),count(g.count)),g.ages.length?bar(average,90,average+" days","#e7a333"):"—",bar(g.stale,Math.max(...[...groups.values()].map(x=>x.stale)),count(g.stale),"#df6b72"),bar(g.value,Math.max(...[...groups.values()].map(x=>x.value)),formatMoney(g.value),"#3186db")];}))}</section></>;
  } else if (view === "Lead sources") {
    const groups = new Map<string,{count:number;won:number;lost:number;open:number;value:number;wonValue:number}>();
    for(const o of rows){const name=(o.source||"Not set").trim()||"Not set";const g=groups.get(name)||{count:0,won:0,lost:0,open:0,value:0,wonValue:0};g.count++;g.value+=num(o.monetaryValue);const s=(o.status||"").toLowerCase();if(s==="won"){g.won++;g.wonValue+=num(o.monetaryValue)}else if(s==="lost"||s==="abandoned")g.lost++;else g.open++;groups.set(name,g)}
    const list=[...groups.entries()].sort((a,b)=>b[1].count-a[1].count);
    content=<section className="panel lead-report-panel"><div className="panel-head"><div><span className="eyebrow">SOURCE QUALITY</span><h3>Outcomes by GoHighLevel source</h3><p>Opportunity source is grouped as recorded in GHL. It is not campaign-level ad attribution.</p></div></div>{table(["GHL source","Leads","Won","Lost","Open","Win rate","Won value"],list.map(([name,g])=>[name,bar(g.count,Math.max(...list.map(([,x])=>x.count)),count(g.count)),bar(g.won,Math.max(...list.map(([,x])=>x.won)),count(g.won),"#10a779"),bar(g.lost,Math.max(...list.map(([,x])=>x.lost)),count(g.lost),"#e36b72"),bar(g.open,Math.max(...list.map(([,x])=>x.open)),count(g.open),"#f0a323"),g.won+g.lost?bar(g.won/(g.won+g.lost)*100,100,((g.won/(g.won+g.lost))*100).toFixed(1)+"%","#10a779"):"—",bar(g.wonValue,Math.max(...list.map(([,x])=>x.wonValue)),formatMoney(g.wonValue),"#3186db")]))}</section>;
  } else if (view === "Sales team") {
    const groups=new Map<string,{count:number;won:number;lost:number;open:number;value:number;wonValue:number}>();
    for(const o of rows){const id=(o.assignedTo||"").trim();const key=id||"Unassigned";const g=groups.get(key)||{count:0,won:0,lost:0,open:0,value:0,wonValue:0};g.count++;g.value+=num(o.monetaryValue);const s=(o.status||"").toLowerCase();if(s==="won"){g.won++;g.wonValue+=num(o.monetaryValue)}else if(s==="lost"||s==="abandoned")g.lost++;else g.open++;groups.set(key,g)}
    const list=[...groups.entries()].sort((a,b)=>b[1].wonValue-a[1].wonValue);
    content=<section className="panel lead-report-panel"><div className="panel-head"><div><span className="eyebrow">OWNER PERFORMANCE</span><h3>Opportunities by assigned GHL user</h3><p>GHL returns user IDs here. Connect a user-name lookup to display team member names; no names are guessed.</p></div></div>{table(["Assigned user","Opportunities","Won","Lost","Open","Win rate","Won value"],list.map(([id,g])=>[id==="Unassigned"?id:`User …${id.slice(-6)}`,bar(g.count,Math.max(...list.map(([,x])=>x.count)),count(g.count)),bar(g.won,Math.max(...list.map(([,x])=>x.won)),count(g.won),"#10a779"),bar(g.lost,Math.max(...list.map(([,x])=>x.lost)),count(g.lost),"#e36b72"),bar(g.open,Math.max(...list.map(([,x])=>x.open)),count(g.open),"#f0a323"),g.won+g.lost?bar(g.won/(g.won+g.lost)*100,100,((g.won/(g.won+g.lost))*100).toFixed(1)+"%","#10a779"):"—",bar(g.wonValue,Math.max(...list.map(([,x])=>x.wonValue)),formatMoney(g.wonValue),"#3186db")]))}</section>;
  } else if (view === "Forecast") {
    const open=opportunities.filter(o=>!["won","lost","abandoned"].includes((o.status||"").toLowerCase()));
    const current=range.to||new Date().toISOString().slice(0,10);
    const end=new Date(current+"T23:59:59Z"); const next=new Date(end);next.setUTCDate(next.getUTCDate()+30);
    const buckets=new Map<string,{count:number;value:number;weighted:number;weightedCount:number}>();
    for(const o of open){const close=safeDate(o.forecastExpectedCloseDate);const bucket=!close?"No close date":close<=end?"Past due / this period":close<=next?"Next 30 days":"Later";const g=buckets.get(bucket)||{count:0,value:0,weighted:0,weightedCount:0};const v=num(o.monetaryValue);g.count++;g.value+=v;const p=o.effectiveProbability??o.forecastProbability;if(p!==undefined&&p!==null&&p!==""){g.weighted+=v*Math.min(100,Math.max(0,num(p)))/100;g.weightedCount++}buckets.set(bucket,g)}
    const order=["Past due / this period","Next 30 days","Later","No close date"];
    content=<><div className="lead-overview-kpis">{kpi("Open pipeline",count(open.length),"Current open opportunities",Users)}{kpi("Open value",formatMoney(open.reduce((s,o)=>s+num(o.monetaryValue),0)),"Unweighted GHL opportunity value",CircleDollarSign)}{kpi("With close dates",count(open.filter(o=>!!safeDate(o.forecastExpectedCloseDate)).length),"Expected-close-date coverage",CalendarClock)}</div><section className="panel lead-report-panel"><div className="panel-head"><div><span className="eyebrow">CLOSE-DATE OUTLOOK</span><h3>Pipeline forecast</h3><p>Weighted value appears only where GHL supplies a forecast probability; blank probability is not assumed.</p></div></div>{table(["Expected close","Open opportunities","Pipeline value","Weighted value"],order.filter(k=>buckets.has(k)).map(k=>{const g=buckets.get(k)!;return[k,bar(g.count,Math.max(...[...buckets.values()].map(x=>x.count)),count(g.count)),bar(g.value,Math.max(...[...buckets.values()].map(x=>x.value)),formatMoney(g.value),"#3186db"),g.weightedCount?bar(g.weighted,Math.max(...[...buckets.values()].map(x=>x.weighted)),formatMoney(g.weighted),"#10a779"):"Not available"]}))}</section></>;
  } else if (view === "Lost reasons") {
    const lost=rows.filter(o=>["lost","abandoned"].includes((o.status||"").toLowerCase()));
    const reasons=new Map((data?.lostReasons||[]).map(r=>[r.id||"",r.name||""]));
    const groups=new Map<string,{count:number;value:number}>();
    for(const o of lost){const key=reasons.get(o.lostReasonId||"")||o.lostReason|| (o.lostReasonId?`Reason …${o.lostReasonId.slice(-6)}`:"Not recorded");const g=groups.get(key)||{count:0,value:0};g.count++;g.value+=num(o.monetaryValue);groups.set(key,g)}
    const list=[...groups.entries()].sort((a,b)=>b[1].count-a[1].count);
    content=<section className="panel lead-report-panel"><div className="panel-head"><div><span className="eyebrow">LOST OPPORTUNITIES</span><h3>Why deals were lost</h3><p>GoHighLevel lost-reason labels are used when available; unlabelled opportunities stay unlabelled.</p></div></div>{table(["Lost reason","Opportunities","Opportunity value"],list.map(([label,g])=>[label,bar(g.count,Math.max(...list.map(([,x])=>x.count)),count(g.count),"#e36b72"),bar(g.value,Math.max(...list.map(([,x])=>x.value)),formatMoney(g.value),"#e36b72")]))}</section>;
  } else {
    const items=opportunities.flatMap(o=>[...(Array.isArray(o.tasks)?o.tasks.map((t)=>({kind:"Task",record:t,opp:o})):[]),...(Array.isArray(o.calendarEvents)?o.calendarEvents.map((e)=>({kind:"Appointment",record:e,opp:o})):[])]);
    const parsed=items.map(item=>{const r=item.record as Record<string,unknown>;const title=String(r.title||r.name||r.subject||r.appointmentTitle||item.kind);const when=String(r.dueDate||r.startTime||r.startAt||r.date||"");const status=String(r.status||((r.completed===true)?"Completed":""));return {kind:item.kind,title,when,status,opp:item.opp.name||item.opp.id||"Opportunity"}}).sort((a,b)=>(a.when||"").localeCompare(b.when||""));
    content=<section className="panel lead-report-panel"><div className="panel-head"><div><span className="eyebrow">TASKS & APPOINTMENTS</span><h3>Upcoming follow-ups</h3><p>Only tasks or calendar events attached to returned opportunities are shown.</p></div><button className="filter-button" onClick={()=>setRevision(x=>x+1)}><RefreshCw/>Refresh</button></div>{data?.followupsNote?<div className="connection-notice"><CalendarClock/><div><strong>Follow-up access is limited</strong><span>{data.followupsNote}</span></div></div>:null}{table(["Type","Follow-up","Date","Status","Opportunity"],parsed.map(x=>[x.kind,x.title,x.when?new Date(x.when).toLocaleString("en-GB"):"—",x.status||"—",x.opp]))}</section>;
  }

  return <section className="lead-overview lead-report-page">
    <div className="lead-overview-heading"><div><span className="eyebrow">GOHIGHLEVEL DEEP DIVE</span><h2>{view}</h2><p>{data?.pipelineName ? `${data.pipelineName} · ` : ""}{range.label}</p></div><button className="filter-button" onClick={()=>setRevision(x=>x+1)} disabled={loading}><RefreshCw className={loading?"spin":""}/>{loading?"Loading…":"Refresh"}</button></div>
    {error?<div className="connection-error" role="alert">{error}</div>:null}
    {loading?<div className="panel lead-overview-loading"><RefreshCw className="spin"/><strong>Loading GoHighLevel report…</strong></div>:content}
    <p className="lead-report-note">Opportunity outcomes, stage and values are a current GoHighLevel snapshot. The selected date range filters creation cohorts and spend periods where relevant; it does not reconstruct historical stage changes.</p>
  </section>;
}
