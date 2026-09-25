"use client";

import { useEffect, useState } from "react";
import { CustomerGeography } from "@/components/customer-geography";

type SalesMonth = { month: string; newOrders: number; newSales: number; repeatOrders: number; repeatSales: number };
type TopCustomer = { id: string; name: string; country: string; orders: number; sales: number };
type Location = { country: string; orders: number; customers: number; sales: number };
type Report = { currency: string; months?: SalesMonth[]; customers?: TopCustomer[]; locations?: Location[]; namesMasked?: boolean };

function last365Days() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function ShopifyCustomerReport({ focus }: { focus: "sales" | "customers" | "geography" }) {
  const [range, setRange] = useState(last365Days);
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
    const params = new URLSearchParams({ focus: focus === "geography" ? "customers" : focus, from: range.from, to: range.to });
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
  }, [focus, range.from, range.to]);

  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: report?.currency || "GBP", maximumFractionDigits: 0 });
  const count = new Intl.NumberFormat("en-GB");
  const title = focus === "sales" ? "New versus repeat sales" : focus === "geography" ? "Sales by country" : "Top Shopify customers";
  return <div className="customer-behaviour">
    <section className="filter-row pnl-period">
      <label>From<input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}/></label>
      <label>To<input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}/></label>
      <button type="button" onClick={() => setRange(last365Days())}>Last 365 days</button>
    </section>
    {error ? <div className="connection-notice"><div><strong>{error}</strong><span>Check the Shopify connection and reporting dates, then try again.</span></div></div> : null}
    {loading ? <div className="data-loading">Loading current Shopify report…</div> : report ? <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">SHOPIFY REPORTS</span><h2>{title}</h2><span className="report-note">From {range.from} to {range.to} · queried from Shopify for this period.</span></div></div>
      {focus === "sales" ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>New orders</th><th>New-customer sales</th><th>Repeat orders</th><th>Repeat sales</th></tr></thead><tbody>
        {report.months?.length ? report.months.map((row) => <tr key={row.month}><td>{new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(row.month + "-01T00:00:00Z"))}</td><td>{count.format(row.newOrders)}</td><td><strong>{money.format(row.newSales)}</strong></td><td>{count.format(row.repeatOrders)}</td><td><strong>{money.format(row.repeatSales)}</strong></td></tr>) : <tr><td colSpan={5} className="empty-row">No Shopify sales data in this period.</td></tr>}
      </tbody></table></div> : focus === "geography" ? <CustomerGeography locations={report.locations ?? []} currency={report.currency}/> : <>
        {report.namesMasked ? <p className="report-note">Customer names are masked for your role.</p> : null}
        <div className="table-scroll"><table className="data-table top-customers-table"><thead><tr><th>Rank</th><th>Customer</th><th>Country</th><th>Orders in period</th><th>Sales in period</th></tr></thead><tbody>
          {report.customers?.length ? report.customers.map((item, index) => <tr key={item.id}><td className="top-customer-rank">{index + 1}</td><td><strong>{item.name}</strong></td><td>{item.country || "—"}</td><td>{count.format(item.orders)}</td><td><div className="top-customer-sales"><span className="top-customer-sales-bar" style={{ width: Math.max(3, item.sales / Math.max(1, report.customers?.[0]?.sales ?? 1) * 100) + "%" }}/><strong>{money.format(item.sales)}</strong></div></td></tr>) : <tr><td colSpan={5} className="empty-row">No Shopify customers in this period.</td></tr>}
        </tbody></table></div>
      </>}
    </section> : null}
  </div>;
}
