"use client";

import { useEffect, useState } from "react";
import { Download, Info, Package, Search } from "lucide-react";
import { type DrilldownContext, type FinanceDatePreset, financeDateRange, FinanceDateControls, downloadCsv, useReportRun, type ProductData } from "@/components/analytics/shared";
import { PanelState } from "@/components/ui/panel-state";

export function Products({ openCosts, reportRunId, initialRange }: { openCosts: (sku: string | null) => void; reportRunId?: string; initialRange?: DrilldownContext }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<ProductData | null>(null);
  const [comparisonData, setComparisonData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [fromDate, setFromDate] = useState(initialRange?.from || "");
  const [toDate, setToDate] = useState(initialRange?.to || "");
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange ? "custom" : "all_imported");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    let comparisonUrl: string | null = null;
    if (fromDate && toDate) {
      const start = new Date(`${fromDate}T00:00:00Z`);
      const end = new Date(`${toDate}T00:00:00Z`);
      const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      const previousEnd = new Date(start); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
      const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
      comparisonUrl = `/api/analytics/products?from=${previousStart.toISOString().slice(0, 10)}&to=${previousEnd.toISOString().slice(0, 10)}`;
    }
    Promise.all([
      fetch(`/api/analytics/products${params.size ? `?${params}` : ""}`).then(async (response) => response.ok ? response.json() as Promise<ProductData> : null),
      comparisonUrl ? fetch(comparisonUrl).then(async (response) => response.ok ? response.json() as Promise<ProductData> : null) : Promise.resolve(null),
    ])
      .then(([payload, comparison]) => { setData(payload); setComparisonData(comparison); finishReportRun(payload ? "completed" : "failed", payload?.products.length ?? null); })
      .catch(() => { setData(null); setComparisonData(null); finishReportRun("failed", null, "Product data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, finishReportRun]);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const products = data?.products ?? [];
  const selectedProduct = products.find((product) => product.key === selectedProductKey) ?? products[0] ?? null;
  const comparisonByKey = new Map((comparisonData?.products ?? []).map((product) => [product.key, product]));
  const percentChange = (current: number, previous: number) => previous ? (current - previous) / Math.abs(previous) * 100 : null;
  const visibleProducts = products.filter((product) => `${product.product} ${product.variant} ${product.sku ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (filter === "all" || filter === "missing" && product.missingCostUnits > 0 || filter === "low-margin" && product.contributionMargin !== null && product.contributionMargin < 0.3 || filter === "loss-making" && product.contributionProfit < 0));
  const exportProducts = () => downloadCsv("product-profitability.csv", [["Report", "Product profitability"], ["Period", data?.period ? `${data.period.start} to ${data.period.end}` : "No imported orders"], ["Timezone", data?.timezone || "UTC"], ["Currency", data?.currency || "GBP"], ["Filters", [search.trim() ? `Search: ${search.trim()}` : "", filter !== "all" ? `Margin filter: ${filter}` : ""].filter(Boolean).join(" · ") || "None"], ["Shared-cost allocation", "Payment fees and ad spend are proportional to product net revenue in the selected period"], ["Generated at", new Date().toISOString()], [], ["Product", "Variant", "SKU", "Units", "Sales after discounts", "Discounts", "Refunds", "Net revenue", "COGS", "Gross profit", "Gross margin", "Shipping", "Handling", "Payment fees", "Marketing allocation", "Contribution profit", "Contribution margin"], ...visibleProducts.map((product) => [product.product, product.variant, product.sku || "", product.units, product.revenue, product.discounts, product.refunds, product.netRevenue, product.cogs, product.grossProfit, product.margin === null ? "" : product.margin, product.shippingCosts, product.handlingCosts, product.transactionFeeAllocation, product.marketingAllocation, product.contributionProfit, product.contributionMargin === null ? "" : product.contributionMargin])]);
  return <>
    <FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={(preset) => { setDatePreset(preset); if (preset !== "custom") { const range = financeDateRange(preset); setFromDate(range.from); setToDate(range.to); } }} onFrom={(value) => { setDatePreset("custom"); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setToDate(value); }}/>
    {loading ? <PanelState status="loading" message="Calculating product profitability…"/> : data && !data.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to see product profitability</strong><span>Revenue, costs, and contribution margin become available after your first order sync.</span></div></div> : null}{data?.marketingCurrencyCoverage.convertedRows ? <div className="connection-notice"><Info/><div><strong>{data.marketingCurrencyCoverage.convertedRows.toLocaleString()} advertising spend rows converted to {data.currency}</strong><span>Converted spend is allocated across products by net revenue.</span></div></div> : null}{data?.marketingCurrencyCoverage.excludedRows ? <div className="connection-notice"><Info/><div><strong>{data.marketingCurrencyCoverage.excludedRows.toLocaleString()} advertising spend rows excluded</strong><span>Add dated exchange rates before treating product contribution profit as complete.</span></div></div> : null}
    {selectedProduct?.trend.length ? <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">PRODUCT TREND</span><h2>{selectedProduct.product} · {selectedProduct.variant}</h2></div><span className="report-note">Monthly net revenue and units for the current date selection.</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>Units</th><th>Sales after discounts</th><th>Refunds</th><th>Net revenue</th></tr></thead><tbody>{selectedProduct.trend.map((period) => <tr key={period.period}><td><strong>{period.period}</strong></td><td>{period.units.toLocaleString()}</td><td>{formatter.format(period.revenue)}</td><td>{period.refunds ? formatter.format(-period.refunds) : "—"}</td><td><strong>{formatter.format(period.netRevenue)}</strong></td></tr>)}</tbody></table></div></section> : null}
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">PRODUCT PERFORMANCE</span><h2>Product profitability</h2></div><div className="feature-actions"><span className="report-note">Payment fees and marketing spend are allocated by product net revenue. Effective-dated product, shipping, and handling costs use each order date.</span><button className="export-button" disabled={!data?.products.length} onClick={exportProducts}><Download/> Export CSV</button></div></div>
      {data?.hasData ? <>
        <div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU..."/></div><select aria-label="Product filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All products</option><option value="missing">Missing costs</option><option value="low-margin">Contribution margin under 30%</option><option value="loss-making">Loss-making contribution</option></select></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Units</th><th>Sales after discounts</th><th>Refunds</th><th>Net revenue</th><th>COGS</th><th>Gross profit</th><th>Gross margin</th><th>Shipping</th><th>Handling</th><th>Payment fees</th><th>Marketing</th><th>Contribution profit</th><th>Contribution margin</th><th>Contribution vs previous</th><th/></tr></thead><tbody>{visibleProducts.length ? visibleProducts.map((product) => { const previous = comparisonByKey.get(product.key); const change = previous ? percentChange(product.contributionProfit, previous.contributionProfit) : null; return <tr key={product.key}><td><strong>{product.product}</strong><small>{product.variant}</small></td><td>{product.sku || "—"}</td><td>{product.units.toLocaleString()}</td><td><strong>{formatter.format(product.revenue)}</strong>{product.discounts > 0 && <small>{formatter.format(product.discounts)} discounts</small>}</td><td>{product.refunds ? formatter.format(-product.refunds) : "—"}</td><td><strong>{formatter.format(product.netRevenue)}</strong></td><td>{product.missingCostUnits ? <span className="cost-warning">{product.missingCostUnits.toLocaleString()} units missing cost</span> : formatter.format(product.cogs)}</td><td>{product.missingCostUnits ? "—" : <strong>{formatter.format(product.grossProfit)}</strong>}</td><td>{product.margin === null ? "—" : `${(product.margin * 100).toFixed(1)}%`}</td><td>{formatter.format(product.shippingCosts)}</td><td>{formatter.format(product.handlingCosts)}</td><td>{formatter.format(product.transactionFeeAllocation)}</td><td>{formatter.format(product.marketingAllocation)}</td><td>{product.missingCostUnits ? "—" : <strong>{formatter.format(product.contributionProfit)}</strong>}</td><td>{product.contributionMargin === null ? "—" : `${(product.contributionMargin * 100).toFixed(1)}%`}</td><td>{comparisonData ? previous ? change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "New" : "Select both dates"}</td><td><div className="feature-actions"><button onClick={() => setSelectedProductKey(product.key)}>Trend</button><button onClick={() => openCosts(product.sku)}>Costs</button></div></td></tr>; }) : <tr><td colSpan={17} className="empty-row">No products match that filter.</td></tr>}</tbody></table></div>
      </> : <div className="cost-empty"><Package/><strong>Product report ready</strong><span>Connect Shopify and run your first order sync to populate this report.</span></div>}
    </section>
  </>;
}
