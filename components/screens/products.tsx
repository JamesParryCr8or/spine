"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Package, Search } from "lucide-react";
import { type DrilldownContext, type FinanceDatePreset, financeDateRange, FinanceDateControls, useReportRun } from "@/components/analytics/shared";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/form-field";
import { Panel } from "@/components/ui/panel";
import { PanelState, UpdatingChip } from "@/components/ui/panel-state";
import { StatCard } from "@/components/ui/stat-card";
import { fetchJson, peekJson } from "@/lib/queries/client";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import type { ProductPerformance, ProductRow, TrendPoint, VariantRow } from "@/lib/analytics/product-performance";

type ProductsData = ProductPerformance & { currency: string; timezone: string; period: { from: string; to: string } };

const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const earliestDate = "2015-01-01";
const monthLabel = (month: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

function MonthlyChart({ points, money }: { points: TrendPoint[]; money: (value: number) => string }) {
  const max = Math.max(0, ...points.map((point) => point.netSales));
  return <div className="trend-chart" role="img" aria-label="Monthly net sales">
    {points.map((point) => <div key={point.month} title={`${monthLabel(point.month)}: ${money(point.netSales)} net sales, ${point.units.toLocaleString()} units`}>
      <span className="pair"><b className="sales" style={{ height: `${max > 0 ? Math.max(2, (point.netSales / max) * 100) : 0}%` }}/></span>
      <small>{monthLabel(point.month)}</small>
    </div>)}
  </div>;
}

export function Products({ openCosts, reportRunId, initialRange }: { openCosts: (sku: string | null) => void; reportRunId?: string; initialRange?: DrilldownContext }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<ProductsData | null>(null);
  const [fromDate, setFromDate] = useState(initialRange?.from || financeDateRange("last_365_days").from);
  const [toDate, setToDate] = useState(initialRange?.to || financeDateRange("last_365_days").to);
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange?.from ? "custom" : "last_365_days");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [search, setSearch] = useState(initialRange?.search ?? "");
  const [selected, setSelected] = useState<string | null>(null);

  const effectiveFrom = fromDate || earliestDate;
  const effectiveTo = toDate || new Date().toISOString().slice(0, 10);
  useResetOnChange(`${effectiveFrom}|${effectiveTo}|${retryToken}`, () => { setData(null); setLoadError(""); setSelected(null); });
  useEffect(() => {
    const url = `/api/analytics/product-performance?${new URLSearchParams({ from: effectiveFrom, to: effectiveTo })}`;
    const controller = new AbortController();
    void (async () => {
      // Paint the last real numbers immediately, then refresh behind them.
      const cached = await peekJson<ProductsData>(url);
      if (controller.signal.aborted) return;
      if (cached) { setData(cached.data); if (!cached.fresh) setRefreshing(true); }
      try {
        const payload = await fetchJson<ProductsData>(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(payload);
        finishReportRun("completed", payload.totals.products);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (!cached) { setLoadError(reason instanceof Error ? reason.message : "Product data could not be loaded"); finishReportRun("failed", null, "Product data could not be loaded"); }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [effectiveFrom, effectiveTo, retryToken, finishReportRun]);

  const applyPreset = (preset: FinanceDatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = financeDateRange(preset);
    setFromDate(range.from); setToDate(range.to);
  };
  const controls = <FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={applyPreset} onFrom={(value) => { setDatePreset("custom"); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setToDate(value); }}/>;

  if (loadError) return <>{controls}<PanelState status="error" title="Product data could not be loaded" message={loadError} onRetry={() => setRetryToken((value) => value + 1)}/></>;
  if (!data) return <>{controls}<div className="insight-kpis-loading grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <StatCard key={index} label="Loading" value="" loading/>)}</div><PanelState status="loading" message="Loading product sales from Shopify…" lines={4}/></>;
  if (data.products.length === 0) return <>{controls}<PanelState status="empty" title="No product sales in this period" message="Widen the date range, or connect Shopify and run a sync."/></>;

  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: data.currency, maximumFractionDigits: 0 });
  const { totals } = data;
  const needle = search.trim().toLowerCase();
  const rows = needle ? data.products.filter((product) => product.product.toLowerCase().includes(needle)) : data.products;
  const missingCostProducts = data.products.filter((product) => product.grossProfit === null).length;

  const costCell = (value: number | null, render: (amount: number) => ReactNode) => value === null ? <span className="text-ds-warning">Cost missing</span> : render(value);
  const columns: Column<ProductRow>[] = [
    { key: "product", header: "Product", sortValue: (row) => row.product, render: (row) => <button type="button" onClick={() => setSelected(row.product)} className={`text-left font-semibold hover:text-ds-accent-strong ${selected === row.product ? "text-ds-accent-strong" : ""}`}>{row.product}</button> },
    { key: "units", header: "Units", numeric: true, sortValue: (row) => row.units, render: (row) => row.units.toLocaleString() },
    { key: "gross", header: "Gross sales", numeric: true, sortValue: (row) => row.grossSales, render: (row) => money.format(row.grossSales) },
    { key: "discounts", header: "Discounts", numeric: true, sortValue: (row) => row.discounts, render: (row) => row.discounts ? money.format(-row.discounts) : "—" },
    { key: "refunds", header: "Refunds", numeric: true, sortValue: (row) => row.refunds, render: (row) => row.refunds ? money.format(-row.refunds) : "—" },
    { key: "net", header: "Net sales", numeric: true, sortValue: (row) => row.netSales, render: (row) => <strong className="font-semibold">{money.format(row.netSales)}</strong> },
    { key: "cogs", header: "COGS", numeric: true, sortValue: (row) => row.cogs, render: (row) => costCell(row.cogs, (amount) => money.format(amount)), csv: (row) => row.cogs ?? "" },
    { key: "profit", header: "Gross profit", numeric: true, sortValue: (row) => row.grossProfit, render: (row) => costCell(row.grossProfit, (amount) => <strong className="font-semibold">{money.format(amount)}</strong>), csv: (row) => row.grossProfit ?? "" },
    { key: "margin", header: "Margin", numeric: true, sortValue: (row) => row.marginPct, render: (row) => row.marginPct === null ? "—" : percent(row.marginPct, 1), csv: (row) => row.marginPct === null ? "" : (row.marginPct * 100).toFixed(1) },
  ];

  const selectedProduct = selected ? data.products.find((product) => product.product === selected) ?? null : null;
  const trendPoints = selectedProduct ? data.trend[selectedProduct.product] ?? [] : [];
  const variantColumns: Column<VariantRow>[] = [
    { key: "variant", header: "Variant", sortValue: (row) => row.variant, render: (row) => <span className="font-semibold">{row.variant}</span> },
    { key: "units", header: "Units", numeric: true, sortValue: (row) => row.units, render: (row) => row.units.toLocaleString() },
    { key: "refunds", header: "Refunds", numeric: true, sortValue: (row) => row.refunds, render: (row) => row.refunds ? money.format(-row.refunds) : "—" },
    { key: "net", header: "Net sales", numeric: true, sortValue: (row) => row.netSales, render: (row) => <strong className="font-semibold">{money.format(row.netSales)}</strong> },
    { key: "profit", header: "Gross profit", numeric: true, sortValue: (row) => row.grossProfit, render: (row) => costCell(row.grossProfit, (amount) => money.format(amount)), csv: (row) => row.grossProfit ?? "" },
    { key: "margin", header: "Margin", numeric: true, sortValue: (row) => row.marginPct, render: (row) => row.marginPct === null ? "—" : percent(row.marginPct, 1), csv: (row) => row.marginPct === null ? "" : (row.marginPct * 100).toFixed(1) },
  ];
  const trendColumns: Column<TrendPoint>[] = [
    { key: "month", header: "Month", sortValue: (row) => row.month, render: (row) => monthLabel(row.month) },
    { key: "units", header: "Units", numeric: true, sortValue: (row) => row.units, render: (row) => row.units.toLocaleString() },
    { key: "net", header: "Net sales", numeric: true, sortValue: (row) => row.netSales, render: (row) => money.format(row.netSales) },
  ];

  return <>
    {controls}
    <UpdatingChip show={refreshing}/>
    <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard label="Net sales" value={money.format(totals.netSales)} hint={`${totals.products.toLocaleString()} products sold`}/>
      <StatCard label="Units sold" value={totals.units.toLocaleString()}/>
      <StatCard label="Refunds" value={money.format(-totals.refunds)} hint={totals.grossSales > 0 ? `${percent(totals.refunds / totals.grossSales, 1)} of gross sales` : undefined}/>
      <StatCard label="Gross profit" value={totals.grossProfit === null ? "—" : money.format(totals.grossProfit)} hint={totals.grossProfit === null ? "No product has a full cost yet" : "Products with a full cost only"}/>
      <StatCard label="Margin" value={totals.marginPct === null ? "—" : percent(totals.marginPct, 1)} hint={`${percent(totals.costedShare)} of sales have a recorded cost`}/>
    </section>

    <Panel eyebrow="Product performance" title="Sales, refunds and gross profit" description="Straight from Shopify for the chosen period. Cost and margin show only for products where every sale has a recorded cost; click a product for its monthly trend and variants."
      actions={<div className="relative w-64 max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ds-muted" aria-hidden="true"/><TextInput className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products…" aria-label="Search products"/></div>} flush>
      <DataTable caption="Product performance" columns={columns} rows={rows} rowKey={(row) => row.product} exportName="product-performance.csv" maxHeight="640px"
        empty={<EmptyState icon={<Package/>} title="No products match" description="Try a different search."/>}/>
      {missingCostProducts > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-line bg-ds-canvas px-5 py-3 text-ds-small text-ds-muted">
        <span>{missingCostProducts.toLocaleString()} product{missingCostProducts === 1 ? " has" : "s have"} sales without a recorded cost, so no profit is shown for {missingCostProducts === 1 ? "it" : "them"}. Add unit costs in Shopify to fill them in.</span>
        <Button variant="quiet" size="sm" onClick={() => openCosts(null)}>Open Costs</Button>
      </div>}
    </Panel>

    {selectedProduct && <Panel eyebrow="Selected product" title={selectedProduct.product} description={`${selectedProduct.orders.toLocaleString()} orders · ${selectedProduct.units.toLocaleString()} units · ${money.format(selectedProduct.netSales)} net sales in this period`}
      actions={<Button variant="quiet" size="sm" onClick={() => setSelected(null)}>Close</Button>} flush>
      {trendPoints.length ? <>
        <MonthlyChart points={trendPoints} money={(value) => money.format(value)}/>
        {data.trendTruncated && <p className="px-5 pb-3 text-ds-small text-ds-muted">This is a partial view: Shopify returned more months and products than fit in one request.</p>}
        <DataTable caption={`Monthly sales for ${selectedProduct.product}`} columns={trendColumns} rows={trendPoints} rowKey={(row) => row.month}/>
      </> : <EmptyState title="No monthly sales in the last 12 months" description="Monthly trend covers the last 12 months of the chosen period."/>}
      {selectedProduct.variants.length > 1 && <div className="border-t border-ds-line">
        <h3 className="px-5 pb-2 pt-4 text-ds-body font-semibold text-ds-ink">Variants</h3>
        <DataTable caption={`Variants of ${selectedProduct.product}`} columns={variantColumns} rows={selectedProduct.variants} rowKey={(row) => row.variant}/>
      </div>}
    </Panel>}

    <Panel eyebrow="Not shown here" title="Ad spend, shipping and fees per product">
      <p className="max-w-[75ch] text-ds-small text-ds-muted">Shopify cannot tie ad spend, shipping or payment fees to an individual product, so spreading them by revenue would only give every product the same percentage and say nothing about which ones really earn. For return on ad spend, see UTM Analysis, which matches spend to campaigns.</p>
    </Panel>
  </>;
}
