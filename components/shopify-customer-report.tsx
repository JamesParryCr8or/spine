"use client";

import { useEffect, useState } from "react";
import { CustomerGeography } from "@/components/customer-geography";

type SalesPeriod = { period: string; newOrders: number; newSales: number; repeatOrders: number; repeatSales: number };
type TopCustomer = { id: string; name: string; country: string; orders: number; sales: number };
type Location = { country: string; orders: number; customers: number; sales: number };
type Report = { currency: string; periods?: SalesPeriod[]; customers?: TopCustomer[]; locations?: Location[]; namesMasked?: boolean };

type DatePreset = "last_7_days" | "last_7_complete_days" | "last_30_days" | "last_30_complete_days" | "last_90_days" | "last_365_days" | "today" | "yesterday" | "this_month" | "last_month" | "all_imported" | "custom";
type GroupBy = "day" | "week" | "month" | "quarter" | "year";

function dateRange(preset: DatePreset) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const back = (days: number, end = today) => { const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1); return { from: date(start), to: date(end) }; };
  if (preset === "all_imported") return { from: "2000-01-01", to: date(today) };
  if (preset === "today") return back(1);
  if (preset === "yesterday") { const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1); return back(1, yesterday); }
  if (preset === "last_7_complete_days" || preset === "last_30_complete_days") { const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1); return back(preset === "last_7_complete_days" ? 7 : 30, yesterday); }
  if (preset === "this_month") return { from: date(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: date(today) };
  if (preset === "last_month") return { from: date(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))), to: date(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))) };
  return back(preset === "last_7_days" ? 7 : preset === "last_30_days" ? 30 : preset === "last_90_days" ? 90 : 365);
}

function periodLabel(period: string, groupBy: GroupBy) {
  const date = new Date(period + "T00:00:00Z");
  if (groupBy === "day") return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  if (groupBy === "week") return "Week of " + new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  if (groupBy === "quarter") return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
  if (groupBy === "year") return String(date.getUTCFullYear());
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function ShopifyCustomerReport({ focus }: { focus: "sales" | "customers" | "geography" }) {
  const [range, setRange] = useState(() => dateRange("last_365_days"));
  const [preset, setPreset] = useState<DatePreset>("last_365_days");
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    if (!range.from || !range.to || range.from > range.to) {
      setError("Select a valid start and end date.");
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ focus: focus === "geography" ? "customers" : focus, from: range.from, to: range.to, groupBy });
    fetch(`/api/analytics/shopify-customer-reports?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Shopify report could not be loaded");
        setReport(payload as Report);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setReport(null);
        setError(cause instanceof Error ? cause.message : "Shopify report could not be loaded");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [focus, range.from, range.to, groupBy]);

  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: report?.currency || "GBP", maximumFractionDigits: 0 });
  const count = new Intl.NumberFormat("en-GB");
  const title = focus === "sales" ? "New versus repeat sales" : focus === "geography" ? "Sales by country" : "Top Shopify customers";
  return <div className="customer-behaviour">
    <section className="filter-row pnl-period finance-date-controls">
      <label>Period<select aria-label="Shopify report period" value={preset} onChange={(event) => { const next = event.target.value as DatePreset; setPreset(next); if (next !== "custom") { setRange(dateRange(next)); if (next === "all_imported" && (groupBy === "day" || groupBy === "week")) setGroupBy("month"); } }}>
        <option value="last_7_days">Last 7 days (today)</option><option value="last_7_complete_days">Last 7 complete days</option>
        <option value="last_30_days">Last 30 days (today)</option><option value="last_30_complete_days">Last 30 complete days</option>
        <option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option>
        <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This month</option>
        <option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option>
      </select></label>
      <label>From<input type="date" value={range.from} onChange={(event) => { setPreset("custom"); setRange((current) => ({ ...current, from: event.target.value })); }}/></label>
      <label>To<input type="date" value={range.to} onChange={(event) => { setPreset("custom"); setRange((current) => ({ ...current, to: event.target.value })); }}/></label>
      {focus === "sales" ? <label>Group by<select aria-label="Customer sales group by" value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
        <option value="day" disabled={preset === "all_imported"}>Daily</option><option value="week" disabled={preset === "all_imported"}>Weekly</option>
        <option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Annually</option>
      </select></label> : null}
    </section>
    {error ? <div className="connection-notice"><div><strong>{error}</strong><span>Check the Shopify connection and reporting dates, then try again.</span></div></div> : null}
    {loading ? <div className="data-loading">Loading current Shopify report…</div> : report ? <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">SHOPIFY REPORTS</span><h2>{title}</h2><span className="report-note">From {range.from} to {range.to} · queried from Shopify for this period.</span></div></div>
      {focus === "sales" ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Period</th><th>New orders</th><th>New-customer sales</th><th>Repeat orders</th><th>Repeat sales</th></tr></thead><tbody>
        {report.periods?.length ? report.periods.map((row) => <tr key={row.period}><td>{periodLabel(row.period, groupBy)}</td><td>{count.format(row.newOrders)}</td><td><strong>{money.format(row.newSales)}</strong></td><td>{count.format(row.repeatOrders)}</td><td><strong>{money.format(row.repeatSales)}</strong></td></tr>) : <tr><td colSpan={5} className="empty-row">No Shopify sales data in this period.</td></tr>}
      </tbody></table></div> : focus === "geography" ? <CustomerGeography locations={report.locations ?? []} currency={report.currency}/> : <>
        {report.namesMasked ? <p className="report-note">Customer names are masked for your role.</p> : null}
        <div className="table-scroll"><table className="data-table top-customers-table"><thead><tr><th>Rank</th><th>Customer</th><th>Country</th><th>Orders in period</th><th>Sales in period</th></tr></thead><tbody>
          {report.customers?.length ? report.customers.map((item, index) => <tr key={item.id}><td className="top-customer-rank">{index + 1}</td><td><strong>{item.name}</strong></td><td>{item.country || "—"}</td><td>{count.format(item.orders)}</td><td><div className="top-customer-sales"><span className="top-customer-sales-bar" style={{ width: Math.max(3, item.sales / Math.max(1, report.customers?.[0]?.sales ?? 1) * 100) + "%" }}/><strong>{money.format(item.sales)}</strong></div></td></tr>) : <tr><td colSpan={5} className="empty-row">No Shopify customers in this period.</td></tr>}
        </tbody></table></div>
      </>}
    </section> : null}
  </div>;
}
