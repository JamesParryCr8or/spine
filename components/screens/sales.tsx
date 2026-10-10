"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { default365DayRange, type FinanceDatePreset, financeDateRange, FinanceDateControls, useReportRun } from "@/components/analytics/shared";
import { PanelState, UpdatingChip } from "@/components/ui/panel-state";
import { fetchJson, peekJson } from "@/lib/queries/client";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import type { ComboRow, DomainRow, MarginRow, RankRow, SalesInsights, TimeBucket } from "@/lib/analytics/sales-insights";

type InsightsData = SalesInsights & { hasData: boolean; currency: string; timezone: string; dataRange?: { from: string; to: string } | null };

const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Horizontal share bar: width is the row's value relative to the largest in its list. */
function Bar({ value, max, tone = "purple" }: { value: number; max: number; tone?: "purple" | "green" }) {
  return <i className={`insight-bar ${tone}`}><b style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0}%` }}/></i>;
}

function RankList({ title, eyebrow, rows, money, note }: { title: string; eyebrow: string; rows: RankRow[]; money: (value: number) => string; note?: string }) {
  const max = Math.max(0, ...rows.map((row) => row.sales));
  return <article className="panel report-panel insight-panel">
    <div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>
    {note && <span className="report-note insight-note">{note}</span>}
    {rows.length ? <ul className="rank-list">{rows.map((row) => <li key={row.label}><div><strong>{row.label}</strong><span>{money(row.sales)} · {row.orders.toLocaleString()} orders</span></div><Bar value={row.sales} max={max}/></li>)}</ul> : <PanelState status="empty" title="Nothing to show yet"/>}
  </article>;
}

function TimeChart({ buckets, labels, metric, money }: { buckets: TimeBucket[]; labels: string[]; metric: "sales" | "orders"; money: (value: number) => string }) {
  const values = buckets.map((bucket) => bucket[metric]);
  const max = Math.max(0, ...values);
  const peak = values.indexOf(max);
  return <div className="time-chart" role="img" aria-label="Sales by time">
    {buckets.map((bucket, index) => <div key={labels[index]} className={index === peak && max > 0 ? "peak" : ""} title={`${labels[index]}: ${metric === "sales" ? money(bucket.sales) : bucket.orders.toLocaleString()} ${metric === "sales" ? "" : "orders"}`}>
      <b style={{ height: `${max > 0 ? Math.max(2, (values[index] / max) * 100) : 0}%` }}/>
      <span>{labels[index]}</span>
    </div>)}
  </div>;
}

export function Sales({ reportRunId }: { reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<InsightsData | null>(null);
  const [fromDate, setFromDate] = useState(default365DayRange.from);
  const [toDate, setToDate] = useState(default365DayRange.to);
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>("last_365_days");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [timeMetric, setTimeMetric] = useState<"sales" | "orders">("sales");
  const [marginSort, setMarginSort] = useState<"margin" | "marginPct">("margin");

  useResetOnChange(`${fromDate}|${toDate}|${retryToken}`, () => { setData(null); setLoadError(""); });
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const url = `/api/analytics/sales-insights${params.size ? `?${params}` : ""}`;
    const controller = new AbortController();
    void (async () => {
      // Paint the last real numbers immediately, then refresh behind them.
      const cached = await peekJson<InsightsData>(url);
      if (controller.signal.aborted) return;
      if (cached) { setData(cached.data); if (!cached.fresh) setRefreshing(true); }
      try {
        const payload = await fetchJson<InsightsData>(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(payload);
        finishReportRun("completed", payload.summary.orders);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (!cached) { setLoadError(reason instanceof Error ? reason.message : "Sales insights could not be loaded"); finishReportRun("failed", null, "Sales insights could not be loaded"); }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [fromDate, toDate, retryToken, finishReportRun]);

  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 2 });
  const applyPreset = (preset: FinanceDatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = financeDateRange(preset);
    setFromDate(range.from); setToDate(range.to);
  };

  const controls = <FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={applyPreset} onFrom={(value) => { setDatePreset("custom"); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setToDate(value); }}/>;

  if (loadError) return <>{controls}<PanelState status="error" title="Sales insights could not be loaded" message={loadError} onRetry={() => setRetryToken((value) => value + 1)}/></>;
  if (!data) return <>{controls}<PanelState status="loading" message="Finding patterns in your orders…" lines={5}/></>;
  if (!data.hasData) {
    const range = data.dataRange;
    const label = (date: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
    return <>{controls}<PanelState status="empty" title="No Shopify orders in this period" message={range ? `This store's orders run from ${label(range.from)} to ${label(range.to)}.` : "Connect Shopify and run the first sync, or widen the date range."}/>
      {range && <button className="primary empty-action" onClick={() => { setDatePreset("custom"); setFromDate(range.from); setToDate(range.to); }}>Show {label(range.from)} to {label(range.to)}</button>}</>;
  }

  const { summary } = data;
  const hourLabels = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
  const dayLabels = weekdayNames.map((name) => name.slice(0, 3));
  const peakHour = data.byHour.reduce((best, bucket, hour) => bucket[timeMetric] > data.byHour[best][timeMetric] ? hour : best, 0);
  const peakDay = data.byWeekday.reduce((best, bucket, day) => bucket[timeMetric] > data.byWeekday[best][timeMetric] ? day : best, 0);
  const domains: DomainRow[] = data.domains.rows.slice(0, 10);
  const maxDomain = Math.max(0, ...domains.map((row) => row.sales));
  const marginRows: MarginRow[] = [...data.margin.rows].sort((left, right) => right[marginSort] - left[marginSort]).slice(0, 10);
  const maxMargin = Math.max(0, ...marginRows.map((row) => row.margin));
  const combos: ComboRow[] = data.combos.slice(0, 8);
  const maxCombo = Math.max(0, ...combos.map((row) => row.orders));

  return <>
    {controls}
    <UpdatingChip show={refreshing}/>
    <section className="insight-kpis">
      <div><span>Net sales</span><strong>{money.format(summary.netSales)}</strong></div>
      <div><span>Orders</span><strong>{summary.orders.toLocaleString()}</strong></div>
      <div><span>Average order value</span><strong>{money2.format(summary.aov)}</strong></div>
      <div><span>Units per order</span><strong>{summary.unitsPerOrder.toFixed(2)}</strong></div>
      <div><span>Repeat customer orders</span><strong>{summary.repeatRate === null ? "—" : percent(summary.repeatRate)}</strong></div>
      <div><span>Orders with 2+ products</span><strong>{percent(summary.multiProductShare)}</strong></div>
      <div><span>Orders using a discount</span><strong>{percent(summary.discountedShare)}</strong></div>
    </section>

    <section className="insight-grid">
      <article className="panel report-panel insight-panel wide">
        <div className="panel-head"><div><span className="eyebrow">BASKETS</span><h2>Products bought together</h2></div></div>
        <span className="report-note insight-note">Pairs of products that appear in the same order. The percentage is how often buyers of the less common product also bought the other.</span>
        {combos.length ? <ul className="rank-list">{combos.map((row) => <li key={`${row.a}|${row.b}`}><div><strong>{row.a} <em>+</em> {row.b}</strong><span>{row.orders.toLocaleString()} orders · {money.format(row.netSales)} · {percent(row.confidence)} attach rate</span></div><Bar value={row.orders} max={maxCombo}/></li>)}</ul> : <PanelState status="empty" title="No repeated combinations yet" message="Needs at least two orders containing the same pair of products."/>}
      </article>

      <article className="panel report-panel insight-panel wide">
        <div className="panel-head"><div><span className="eyebrow">TIMING</span><h2>When customers buy</h2></div><div className="segmented">{(["sales", "orders"] as const).map((key) => <button key={key} className={timeMetric === key ? "active" : ""} onClick={() => setTimeMetric(key)}>{key === "sales" ? "Net sales" : "Orders"}</button>)}</div></div>
        <span className="report-note insight-note">Busiest hour is {hourLabels[peakHour]}:00 and busiest day is {weekdayNames[peakDay]}, in store time ({data.timezone}).</span>
        <div className="time-charts"><div><h3>By hour</h3><TimeChart buckets={data.byHour} labels={hourLabels} metric={timeMetric} money={(value) => money.format(value)}/></div><div><h3>By weekday</h3><TimeChart buckets={data.byWeekday} labels={dayLabels} metric={timeMetric} money={(value) => money.format(value)}/></div></div>
      </article>

      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">MARKETS</span><h2>Store domains by revenue</h2></div></div>
        <span className="report-note insight-note">The storefront domain each order&apos;s visit landed on, so you can compare your Shopify Markets. Covers {percent(data.domains.coverage)} of orders; the rest have no tracked visit.</span>
        {domains.length ? <ul className="rank-list">{domains.map((row) => <li key={row.domain}><div><strong>{row.domain}</strong><span>{money.format(row.sales)} · {row.orders.toLocaleString()} orders · {money2.format(row.aov)} average order</span></div><Bar value={row.sales} max={maxDomain}/></li>)}</ul> : <PanelState status="empty" title="No storefront domains recorded" message="Shopify did not report a landing page for orders in this period."/>}
      </article>

      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">PROFITABILITY</span><h2>Biggest contribution margin</h2></div><div className="segmented">{(["margin", "marginPct"] as const).map((key) => <button key={key} className={marginSort === key ? "active" : ""} onClick={() => setMarginSort(key)}>{key === "margin" ? "Amount" : "Percent"}</button>)}</div></div>
        <span className="report-note insight-note">Net sales minus product cost, before shipping and fees. Only products with a known cost on every sale are ranked.</span>
        {marginRows.length ? <ul className="rank-list">{marginRows.map((row) => <li key={row.product}><div><strong>{row.product}</strong><span>{money.format(row.margin)} margin · {percent(row.marginPct)} · {row.units.toLocaleString()} units</span></div><Bar value={row.margin} max={maxMargin} tone="green"/></li>)}</ul> : <PanelState status="empty" title="No products have complete costs yet" message="Add product costs on the Costs screen, or sync Shopify unit costs, and margins appear here."/>}
        {data.margin.incompleteProducts > 0 && <div className="insight-foot"><Info/>{data.margin.incompleteProducts.toLocaleString()} product{data.margin.incompleteProducts === 1 ? " is" : "s are"} missing a cost and not ranked ({percent(data.margin.costedShare)} of product sales have a cost).</div>}
      </article>

      <RankList eyebrow="GEOGRAPHY" title="Countries by revenue" rows={data.countries} money={(value) => money.format(value)}/>
      <RankList eyebrow="CHANNELS" title="Sales channels" rows={data.channels} money={(value) => money.format(value)}/>
      <RankList eyebrow="NEW VS REPEAT" title="Customer type" rows={data.customerTypes} money={(value) => money.format(value)}/>
      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">PROMOTIONS</span><h2>Discount codes</h2></div></div>
        <span className="report-note insight-note">Revenue from orders using each code, and the discount value given away.</span>
        {data.discountCodes.length ? <ul className="rank-list">{data.discountCodes.map((row) => <li key={row.label}><div><strong>{row.label}</strong><span>{money.format(row.sales)} · {row.orders.toLocaleString()} orders{row.label === "No discount code" ? "" : ` · ${money.format(row.discounts)} discounted`}</span></div><Bar value={row.sales} max={Math.max(...data.discountCodes.map((code) => code.sales))}/></li>)}</ul> : <PanelState status="empty" title="No discount codes used"/>}
      </article>
    </section>
  </>;
}
