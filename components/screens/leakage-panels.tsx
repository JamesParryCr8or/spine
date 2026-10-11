"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { PanelState, UpdatingChip } from "@/components/ui/panel-state";
import { fetchJson, peekJson } from "@/lib/queries/client";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import type { Leakage } from "@/lib/analytics/leakage";

type LeakageData = Leakage & { currency: string; timezone: string };

const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;

function Bar({ value, max, tone = "purple" }: { value: number; max: number; tone?: "purple" | "amber" }) {
  return <i className={`insight-bar ${tone}`}><b style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0}%` }}/></i>;
}

const monthLabel = (month: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

/** Where money leaks away: refunds, discounts, shipping and fees. All figures are Shopify aggregates for the chosen period. */
export function LeakagePanels({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<LeakageData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);

  useResetOnChange(`${from}|${to}|${retry}`, () => { setData(null); setError(""); });
  useEffect(() => {
    const url = `/api/analytics/leakage?${new URLSearchParams({ from, to })}`;
    const controller = new AbortController();
    void (async () => {
      const cached = await peekJson<LeakageData>(url);
      if (controller.signal.aborted) return;
      if (cached) { setData(cached.data); if (!cached.fresh) setRefreshing(true); }
      try {
        const payload = await fetchJson<LeakageData>(url, { signal: controller.signal });
        if (!controller.signal.aborted) setData(payload);
      } catch (reason) {
        if (!controller.signal.aborted && !cached) setError(reason instanceof Error ? reason.message : "Leakage reports could not be loaded");
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [from, to, retry]);

  const heading = <div className="section-heading"><span className="eyebrow">PROFIT LEAKS</span><h2>Where money leaks away</h2></div>;
  if (error) return <>{heading}<PanelState status="error" title="Leakage reports could not be loaded" message={error} onRetry={() => setRetry((value) => value + 1)}/></>;
  if (!data) return <>{heading}<PanelState status="loading" message="Checking refunds, discounts, shipping and fees…" lines={4}/></>;

  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: data.currency, maximumFractionDigits: 0 });
  const maxRefund = Math.max(0, ...data.refunds.map((row) => row.refunded));
  const maxDiscount = Math.max(0, ...data.discounts.rows.map((row) => row.discounts));
  const maxShipping = Math.max(0, ...data.shipping.rows.map((row) => data.shipping.hasEstimate ? Math.abs(row.result ?? 0) : row.charged));
  const maxFeeRate = Math.max(0, ...data.fees.map((row) => row.rate ?? 0));

  return <>
    {heading}
    <UpdatingChip show={refreshing}/>
    <section className="insight-grid">
      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">REFUNDS</span><h2>Refunds by product</h2></div></div>
        <span className="report-note insight-note">Refunded value against gross sales for each product, biggest refunds first.</span>
        {data.refunds.length ? <ul className="rank-list">{data.refunds.map((row) => <li key={row.product}><div><strong>{row.product}</strong><span>{money.format(row.refunded)} refunded of {money.format(row.grossSales)} · {percent(row.rate, 1)} refund rate</span></div><Bar value={row.refunded} max={maxRefund} tone="amber"/></li>)}</ul> : <PanelState status="empty" title="No refunds in this period"/>}
      </article>

      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">DISCOUNTS</span><h2>Discount codes: what they cost</h2></div></div>
        <span className="report-note insight-note">Discount given away per code{data.discounts.baselineMarginPct !== null ? `, with gross margin against ${percent(data.discounts.baselineMarginPct)} on orders without a code` : ""}. Margin shows only where every sale has a recorded cost.</span>
        {data.discounts.rows.length ? <ul className="rank-list">{data.discounts.rows.map((row) => <li key={row.code}><div><strong>{row.code}</strong><span>{money.format(row.discounts)} given · {percent(row.discountRate)} off · {row.orders.toLocaleString()} orders · {money.format(row.netSales)} sales · {row.marginPct === null ? "margin unknown" : `${percent(row.marginPct)} margin`}</span></div><Bar value={row.discounts} max={maxDiscount} tone="amber"/></li>)}</ul> : <PanelState status="empty" title="No discount codes used"/>}
      </article>

      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">SHIPPING</span><h2>Shipping by country</h2></div></div>
        <span className="report-note insight-note">{data.shipping.hasEstimate ? "Shipping charged minus an estimate of postage and fulfilment from your default rates (Settings), worst countries first." : "Shipping charged per country. Set default postage and fulfilment rates in Settings to see profit or loss."}</span>
        {data.shipping.rows.length ? <ul className="rank-list">{data.shipping.rows.map((row) => <li key={row.country}><div><strong>{row.country}</strong><span>{row.result === null ? `${money.format(row.charged)} charged · ${row.orders.toLocaleString()} orders` : `${money.format(row.charged)} charged vs about ${money.format(row.estimatedCost ?? 0)} cost · ${row.result < 0 ? "loses" : "makes"} ${money.format(Math.abs(row.result))}`}</span></div><Bar value={data.shipping.hasEstimate ? Math.abs(row.result ?? 0) : row.charged} max={maxShipping} tone={row.result !== null && row.result < 0 ? "amber" : "purple"}/></li>)}</ul> : <PanelState status="empty" title="No shipping data in this period"/>}
      </article>

      <article className="panel report-panel insight-panel">
        <div className="panel-head"><div><span className="eyebrow">FEES</span><h2>Payment fees over time</h2></div></div>
        <span className="report-note insight-note">Shopify Payments processing, foreign-exchange and international fees as a share of total sales each month.</span>
        {data.fees.length ? <ul className="rank-list">{data.fees.map((row) => <li key={row.month}><div><strong>{monthLabel(row.month)}</strong><span>{money.format(row.fees)} fees on {money.format(row.sales)} sales · {row.rate === null ? "no sales" : percent(row.rate, 2)}</span></div><Bar value={row.rate ?? 0} max={maxFeeRate} tone="amber"/></li>)}</ul> : <PanelState status="empty" title="No fee data in this period" message="Shopify reports fees for stores using Shopify Payments."/>}
        {data.fees.length > 0 && <div className="insight-foot"><Info/>Fees from other gateways (PayPal, Stripe, Klarna) are not in Shopify&apos;s fee report.</div>}
      </article>
    </section>
  </>;
}
