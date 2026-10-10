"use client";

import { useEffect, useState } from "react";
import { Info, Search } from "lucide-react";
import { type DrilldownContext, type FinanceDatePreset, financeDateRange, FinanceDateControls, downloadCsv, useReportRun } from "@/components/analytics/shared";
import { PanelState, UpdatingChip } from "@/components/ui/panel-state";
import { UtmTools } from "@/components/screens/utm-tools";
import { fetchJson, peekJson } from "@/lib/queries/client";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import type { AttributionModel, CampaignPerformance, CampaignRow } from "@/lib/analytics/campaign-performance";

type CampaignsData = CampaignPerformance & {
  currency: string; timezone: string; model: AttributionModel; hasData: boolean;
  period: { from: string; to: string };
  synced: { at: string; backfilledFrom: string } | null;
  shopifySales: number; attributedShare: number | null;
  spendCoverage: { excludedRows?: number } & Record<string, unknown>;
};

const modelLabels: Record<AttributionModel, string> = { last_non_direct: "Last non-direct click", last_click: "Last click", first_click: "First click" };
const platformLabels = { meta: "Meta", google: "Google Ads", microsoft: "Microsoft Ads" } as const;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const roasText = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}×`;
const linkLabels = { auto: "Auto-matched", manual: "Mapped", custom: "Custom spend" } as const;
const earliestDate = "2015-01-01";

type SortKey = "sales" | "spend" | "roas" | "orders";

function Bar({ value, max, tone = "purple" }: { value: number; max: number; tone?: "purple" | "green" | "amber" }) {
  return <i className={`insight-bar ${tone}`}><b style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0}%` }}/></i>;
}

function WeeklyChart({ points, money }: { points: CampaignsData["weekly"]; money: (value: number) => string }) {
  const max = Math.max(0, ...points.flatMap((point) => [point.sales, point.spend]));
  return <div className="trend-chart" role="img" aria-label="Weekly attributed sales and ad spend">
    {points.map((point) => <div key={point.week} title={`Week of ${point.week}: ${money(point.sales)} sales, ${money(point.spend)} spend`}>
      <span className="pair"><b className="sales" style={{ height: `${max > 0 ? Math.max(2, (point.sales / max) * 100) : 0}%` }}/><b className="spend" style={{ height: `${max > 0 ? Math.max(point.spend > 0 ? 2 : 0, (point.spend / max) * 100) : 0}%` }}/></span>
      <small>{point.week.slice(5)}</small>
    </div>)}
  </div>;
}

export function UTMAnalysis({ reportRunId, initialRange }: { reportRunId?: string; initialRange?: DrilldownContext }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<CampaignsData | null>(null);
  const [fromDate, setFromDate] = useState(initialRange?.from || financeDateRange("last_90_days").from);
  const [toDate, setToDate] = useState(initialRange?.to || financeDateRange("last_90_days").to);
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange?.from ? "custom" : "last_90_days");
  const [model, setModel] = useState<AttributionModel>(initialRange?.attributionModel === "first_touch" ? "first_click" : "last_non_direct");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [search, setSearch] = useState(initialRange?.campaign ?? "");
  const [spendFilter, setSpendFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "sales", direction: -1 });
  const [limit, setLimit] = useState(25);
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [mapStatus, setMapStatus] = useState("");

  const effectiveFrom = fromDate || earliestDate;
  const effectiveTo = toDate || new Date().toISOString().slice(0, 10);
  useResetOnChange(`${effectiveFrom}|${effectiveTo}|${model}|${retryToken}`, () => { setData(null); setLoadError(""); setLimit(25); });
  useEffect(() => {
    const url = `/api/analytics/campaigns?${new URLSearchParams({ from: effectiveFrom, to: effectiveTo, model })}`;
    const controller = new AbortController();
    void (async () => {
      // Paint the last real numbers immediately, then refresh behind them.
      const cached = await peekJson<CampaignsData>(url);
      if (controller.signal.aborted) return;
      if (cached) { setData(cached.data); if (!cached.fresh) setRefreshing(true); }
      try {
        const payload = await fetchJson<CampaignsData>(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(payload);
        finishReportRun("completed", payload.totals.orders);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (!cached) { setLoadError(reason instanceof Error ? reason.message : "Campaign data could not be loaded"); finishReportRun("failed", null, "Campaign data could not be loaded"); }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [effectiveFrom, effectiveTo, model, retryToken, finishReportRun]);

  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 2 });
  const applyPreset = (preset: FinanceDatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = financeDateRange(preset);
    setFromDate(range.from); setToDate(range.to);
  };
  const controls = <>
    <FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={applyPreset} onFrom={(value) => { setDatePreset("custom"); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setToDate(value); }}/>
    <div className="segmented model-switch" role="group" aria-label="Attribution model">{(Object.keys(modelLabels) as AttributionModel[]).map((key) => <button key={key} className={model === key ? "active" : ""} onClick={() => setModel(key)}>{modelLabels[key]}</button>)}</div>
  </>;

  const targets = data ? [...new Map(data.rows.filter((row) => row.source || row.medium || row.campaign).map((row) => [JSON.stringify([row.source, row.medium, row.campaign]), { value: JSON.stringify([row.source, row.medium, row.campaign]), label: `${row.source || "(none)"} / ${row.medium || "(none)"} / ${row.campaign || "(none)"}` }])).values()].sort((left, right) => left.label.localeCompare(right.label)) : [];

  const saveMapping = async (campaignId: string) => {
    const target = mapDraft[campaignId];
    if (!target) return;
    setMapStatus("Saving…");
    try {
      const [utmSource, utmMedium, utmCampaign] = JSON.parse(target) as string[];
      const response = await fetch("/api/settings/campaign-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalCampaignId: campaignId, utmSource, utmMedium, utmCampaign }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the mapping");
      setMapStatus("Mapping saved"); setRetryToken((value) => value + 1);
    } catch (reason) { setMapStatus(reason instanceof Error ? reason.message : "Could not save the mapping"); }
  };

  if (loadError) return <>{controls}<PanelState status="error" title="Campaign data could not be loaded" message={loadError} onRetry={() => setRetryToken((value) => value + 1)}/></>;
  if (!data) return <>{controls}<PanelState status="loading" message="Matching campaigns to spend…" lines={5}/></>;

  const { totals, coverage } = data;
  const tools = <details className="panel report-panel setup-tools"><summary><div><span className="eyebrow">SETUP</span><h2>Tracking links, spend mapping and custom spend</h2></div></summary><UtmTools currency={data.currency} targets={targets} summary={`${money.format(coverage.matchedSpend)} of ${money.format(coverage.campaignSpend)} Meta campaign spend matched · ${money.format(coverage.customSpend)} custom spend`} onChanged={() => setRetryToken((value) => value + 1)}/></details>;

  if (!data.hasData) return <>{controls}<PanelState status="empty" title="No campaign data for this period" message={data.synced ? "Shopify reported no campaign-attributed orders in this period. Try a wider range." : "Campaign data has not been pulled from Shopify yet. Click Sync now: the first sync backfills two years."}/>{tools}</>;

  const matches = (row: CampaignRow) => spendFilter === "all" || (spendFilter === "matched") === (row.spend !== null);
  const needle = search.trim().toLowerCase();
  const value = (row: CampaignRow) => sort.key === "sales" ? row.sales : sort.key === "orders" ? row.orders : sort.key === "spend" ? row.spend ?? -1 : row.roas ?? -1;
  const filtered = data.rows.filter((row) => matches(row) && (!needle || `${row.source} ${row.medium} ${row.campaign}`.toLowerCase().includes(needle))).sort((left, right) => (value(right) - value(left)) * -sort.direction);
  const shown = filtered.slice(0, limit);
  const maxPlatformSales = Math.max(0, ...data.platforms.map((platform) => Math.max(platform.taggedSales, platform.spend)));
  const maxSource = Math.max(0, ...data.sources.slice(0, 10).map((source) => source.sales));
  const sortHeader = (key: SortKey, label: string) => <th><button className={`sort-button${sort.key === key ? " active" : ""}`} onClick={() => setSort((current) => ({ key, direction: current.key === key ? (current.direction === 1 ? -1 : 1) : -1 }))}>{label}{sort.key === key ? (sort.direction === -1 ? " ↓" : " ↑") : ""}</button></th>;
  const label = (row: CampaignRow) => row.campaign || (row.source || row.medium ? "(no campaign)" : "Direct / untagged");
  const exportRows = [["Campaign", "Source", "Medium", "Orders", "Sales", "New-customer orders", "Spend", "Spend link", "ROAS", "Cost per order"],
    ...filtered.map((row) => [label(row), row.source, row.medium, row.orders, row.sales, row.newOrders, row.spend ?? "", row.spendLink ?? "", row.roas === null ? "" : row.roas.toFixed(2), row.cpa === null ? "" : row.cpa.toFixed(2)])];

  return <>
    {controls}
    <UpdatingChip show={refreshing}/>
    <section className="insight-kpis">
      <div><span>Attributed sales</span><strong>{money.format(totals.sales)}</strong><small>{data.attributedShare === null ? "" : `${percent(data.attributedShare)} of Shopify sales`}</small></div>
      <div><span>Ad spend</span><strong>{totals.adSpend > 0 ? money.format(totals.adSpend) : "—"}</strong><small>Meta, Google, Microsoft</small></div>
      <div><span>Blended ROAS</span><strong>{roasText(totals.blendedRoas)}</strong><small>All attributed sales ÷ spend</small></div>
      <div><span>Paid-tagged ROAS</span><strong>{roasText(totals.taggedRoas)}</strong><small>Only paid-tagged links</small></div>
      <div><span>Orders</span><strong>{totals.orders.toLocaleString()}</strong><small>{totals.orders ? `${percent(totals.newOrders / totals.orders)} from new customers` : ""}</small></div>
      <div><span>Untagged sales</span><strong>{percent(totals.untaggedShare)}</strong><small>Direct or no UTM</small></div>
    </section>

    <section className="insight-grid">
      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">PLATFORMS</span><h2>Return on ad spend by platform</h2></div></div>
        <span className="report-note insight-note">Platform spend against Shopify-attributed sales from paid-tagged links. Ad clicks without UTM tags are not counted, so ROAS here is a floor.</span>
        {data.platforms.length ? <ul className="rank-list">{data.platforms.map((platform) => <li key={platform.platform}><div><strong>{platformLabels[platform.platform]} <em>·</em> {roasText(platform.roas)}</strong><span>{money.format(platform.taggedSales)} tagged sales · {platform.taggedOrders.toLocaleString()} orders · {money.format(platform.spend)} spend</span></div><Bar value={platform.taggedSales} max={maxPlatformSales}/><Bar value={platform.spend} max={maxPlatformSales} tone="amber"/></li>)}</ul> : <PanelState status="empty" title="No ad platform data" message="Connect Meta, Google Ads or Microsoft Ads to compare spend with sales."/>}
      </article>

      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">CHANNELS</span><h2>Sales by source and medium</h2></div></div>
        <ul className="rank-list">{data.sources.slice(0, 10).map((source) => <li key={`${source.source}|${source.medium}`}><div><strong>{source.source || source.medium ? `${source.source || "(none)"} / ${source.medium || "(none)"}` : "Direct / untagged"}</strong><span>{money.format(source.sales)} · {source.orders.toLocaleString()} orders{source.spend !== null ? ` · ${money.format(source.spend)} spend · ${roasText(source.roas)}` : ""}</span></div><Bar value={source.sales} max={maxSource}/></li>)}</ul>
      </article>

      <article className="panel report-panel insight-panel wide">
        <div className="panel-head"><div><span className="eyebrow">TREND</span><h2>Weekly attributed sales vs ad spend</h2></div><span className="legend-keys"><i className="sales"/> Sales <i className="spend"/> Spend</span></div>
        <WeeklyChart points={data.weekly.slice(-26)} money={(amount) => money.format(amount)}/>
      </article>

      <article className="panel report-panel insight-panel wide">
        <div className="panel-head"><div><span className="eyebrow">{modelLabels[model].toUpperCase()}</span><h2>Campaign performance</h2></div><button className="export-button" onClick={() => downloadCsv("campaign-performance.csv", exportRows)}>Export CSV</button></div>
        <div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => { setSearch(event.target.value); setLimit(25); }} placeholder="Find a campaign, source or medium..."/></div><div className="segmented">{(["all", "matched", "unmatched"] as const).map((key) => <button key={key} className={spendFilter === key ? "active" : ""} onClick={() => { setSpendFilter(key); setLimit(25); }}>{key === "all" ? "All" : key === "matched" ? "With spend" : "No spend match"}</button>)}</div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Campaign</th>{sortHeader("orders", "Orders")}{sortHeader("sales", "Sales")}{sortHeader("spend", "Spend")}{sortHeader("roas", "ROAS")}<th>Cost / order</th><th>New customers</th></tr></thead>
          <tbody>{shown.length === 0 ? <tr><td colSpan={7} className="empty-row">No campaigns match.</td></tr> : shown.map((row) => <tr key={row.key}>
            <td><strong>{label(row)}</strong><small>{row.source || "(none)"} / {row.medium || "(none)"}</small></td>
            <td>{row.orders.toLocaleString()}</td>
            <td><strong>{money.format(row.sales)}</strong></td>
            <td>{row.spend === null ? <span className="muted">Not matched</span> : <><strong>{money.format(row.spend)}</strong>{row.spendLink && <small className={`link-badge ${row.spendLink}`}>{linkLabels[row.spendLink]}</small>}</>}</td>
            <td>{row.roas === null ? "—" : <strong>{roasText(row.roas)}</strong>}</td>
            <td>{row.cpa === null ? "—" : money2.format(row.cpa)}</td>
            <td>{row.orders ? percent(row.newOrders / row.orders) : "—"}</td>
          </tr>)}</tbody></table></div>
        <div className="table-footer"><span>Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()} campaigns · sales are Shopify total sales (incl. shipping and tax)</span>{filtered.length > shown.length && <button onClick={() => setLimit((current) => current + 50)}>Show more</button>}</div>
      </article>

      <article className="panel report-panel insight-panel wide">
        <div className="panel-head"><div><span className="eyebrow">SPEND MATCHING</span><h2>Meta spend not linked to a campaign</h2></div></div>
        <span className="report-note insight-note">{money.format(coverage.matchedSpend)} of {money.format(coverage.campaignSpend)} Meta campaign spend is linked to UTM campaigns, automatically by name or ID, or by your mapping. Unlinked spend is not added to any campaign&apos;s ROAS.</span>
        {coverage.unmatched.length ? <ul className="unmatched-list">{coverage.unmatched.slice(0, 8).map((campaign) => <li key={campaign.campaignId}>
          <div><strong>{campaign.campaignName}</strong><span>{money.format(campaign.spend)} spend</span></div>
          <select aria-label={`UTM campaign for ${campaign.campaignName}`} value={mapDraft[campaign.campaignId] ?? ""} onChange={(event) => setMapDraft((current) => ({ ...current, [campaign.campaignId]: event.target.value }))}><option value="">Map to a UTM campaign…</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select>
          <button disabled={!mapDraft[campaign.campaignId]} onClick={() => void saveMapping(campaign.campaignId)}>Save</button>
        </li>)}</ul> : <PanelState status="empty" title="All Meta campaign spend is linked" message="Nothing to map for this period."/>}
        {mapStatus && <div className="insight-foot"><Info/>{mapStatus}</div>}
        {data.spendCoverage.excludedRows ? <div className="insight-foot"><Info/>{String(data.spendCoverage.excludedRows)} spend rows were left out because no exchange rate is set for their currency.</div> : null}
      </article>
    </section>
    {tools}
  </>;
}
