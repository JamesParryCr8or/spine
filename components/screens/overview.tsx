"use client";

import { useEffect, useRef, useState } from "react";
import { StatCardSkeleton } from "@/components/ui/skeleton";
import { reportingPeriods, type ReportingGranularity } from "@/lib/analytics/reporting-periods";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import { fetchJson, peekJson } from "@/lib/queries/client";
import { BarChart3, CircleDollarSign, Download, ExternalLink, Info, Megaphone, Package, Settings, Sparkles, TrendingUp, Users, WalletCards } from "lucide-react";
import { type View, type DrilldownContext, default365DayRange, type FinanceDatePreset, financeDateRange, Trend, downloadCsv, useReportRun, type CurrencyCoverage, type CurrencyConversionCoverage, type PnlData, type PnlPeriodData, pnlSeriesKey, fetchPnlSeries, type UtmData, type ProductData, type CustomerData } from "@/components/analytics/shared";
import { PanelState, UpdatingChip } from "@/components/ui/panel-state";

type OverviewWidgetId = "channel" | "products" | "customers" | "costs";

const overviewWidgetIds: OverviewWidgetId[] = ["channel", "products", "customers", "costs"];

const overviewWidgetLabels: Record<OverviewWidgetId, string> = { channel: "Channel mix", products: "Top products", customers: "Customer split", costs: "Cost breakdown" };

type FinanceTrendPoint = {
  label: string; start: string; end: string; revenue: number; profit: number; complete: boolean;
  cogs: number; metaMarketing: number; googleMarketing: number; bingMarketing: number; paymentFees: number; paymentFeesAvailable: boolean; shipping: number; operating: number;
};

function FinanceTrendChart({ points, formatter, onOpen }: { points: FinanceTrendPoint[]; formatter: Intl.NumberFormat; onOpen: (point: FinanceTrendPoint) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!points.length) return <div className="cost-empty"><BarChart3/><strong>No trend data in this period</strong></div>;
  const width = 920, height = 330, left = 58, right = 18, top = 18, bottom = 292;
  const zeroY = (top + bottom) / 2;
  const plotWidth = width - left - right;
  const step = plotWidth / points.length;
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const dataMaximum = Math.max(
    ...points.flatMap((point) => [point.revenue, Math.abs(point.profit)]),
    ...points.map((point) => point.cogs + point.metaMarketing + point.googleMarketing + point.bingMarketing + point.paymentFees + point.shipping + point.operating),
    1,
  );
  const niceStep = (value: number) => {
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    const rounded = [1, 2, 2.5, 5, 10].find((candidate) => normalized <= candidate) ?? 10;
    return rounded * magnitude;
  };
  const axisStep = niceStep(dataMaximum / 4);
  const axisMaximum = axisStep * 4;
  const axisLabel = (value: number) => {
    const absolute = Math.abs(value);
    const symbol = formatter.formatToParts(0).find((part) => part.type === "currency")?.value ?? "";
    const prefix = value < 0 ? "-" : "";
    const compact = (divisor: number, suffix: string) => {
      const scaled = absolute / divisor;
      return `${prefix}${symbol}${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
    };
    if (absolute >= 1_000_000) return compact(1_000_000, "M");
    if (absolute >= 1_000) return compact(1_000, "K");
    return formatter.format(value);
  };
  const y = (value: number) => zeroY - value / axisMaximum * (zeroY - top);
  const positiveTicks = [0, 1, 2, 3, 4].map((index) => ({ index, y: zeroY - (zeroY - top) * index / 4, value: axisStep * index }));
  const negativeTicks = [1, 2, 3, 4].map((index) => ({ index, y: zeroY + (bottom - zeroY) * index / 4, value: -axisStep * index }));
  const line = points.map((point, index) => `${left + step * index + step / 2},${y(point.profit)}`).join(" ");
  const costColors = ["#f59e0b", "#1877f2", "#34a853", "#0f766e", "#a855f7", "#06b6d4", "#64748b"];
  const active = hovered === null ? null : points[hovered];
  return <div className="finance-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue, costs and profit over time">
      <line x1={left} x2={left} y1={top} y2={bottom} className="finance-axis"/>
      {positiveTicks.map((tick) => <g key={`positive-${tick.index}`}><line x1={left} x2={width-right} y1={tick.y} y2={tick.y} className={tick.index === 0 ? "finance-zero" : "finance-grid"}/><text x={left-10} y={tick.y+3} textAnchor="end" className="finance-axis-label">{axisLabel(tick.value)}</text></g>)}
      {negativeTicks.map((tick) => <g key={`negative-${tick.index}`}><line x1={left} x2={width-right} y1={tick.y} y2={tick.y} className="finance-grid"/><text x={left-10} y={tick.y+3} textAnchor="end" className="finance-axis-label">{axisLabel(tick.value)}</text></g>)}
      {points.map((point,index) => {
        const center = left + step * index + step / 2;
        const barWidth = Math.min(30, step * .44);
        const revenueTop = y(point.revenue);
        const costs = [point.cogs, point.metaMarketing, point.googleMarketing, point.bingMarketing, point.paymentFees, point.shipping, point.operating];
        let currentY = zeroY;
        return <g key={`${point.start}-${index}`} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => onOpen(point)} tabIndex={0} role="button" aria-label={`${point.label}: revenue ${formatter.format(point.revenue)}, costs ${formatter.format(costs.reduce((sum,value)=>sum+value,0))}, profit ${formatter.format(point.profit)}`}>
          <rect x={center-barWidth/2} y={revenueTop} width={barWidth} height={Math.max(zeroY-revenueTop,1)} rx="4" className="finance-revenue"/>
          {costs.map((cost,costIndex) => {
            const segmentHeight = cost / axisMaximum * (bottom-zeroY);
            const rect = <rect key={costIndex} x={center-barWidth/2} y={currentY} width={barWidth} height={Math.max(segmentHeight,0)} fill={costColors[costIndex]} />;
            currentY += segmentHeight;
            return rect;
          })}
          <rect x={center-step/2} y={top} width={step} height={bottom-top+20} fill="transparent"/>
          {(index === 0 || index === points.length - 1 || (index % labelEvery === 0 && index < points.length - 1 - Math.floor(labelEvery / 2))) && <text x={center} y={318} textAnchor="middle" className="finance-label">{point.label}</text>}
        </g>;
      })}
      <polyline points={line} className="finance-profit-line"/>
      {points.map((point,index) => <circle key={point.start} cx={left+step*index+step/2} cy={y(point.profit)} r={hovered===index?5:3.5} className="finance-profit-dot"/>)}
    </svg>
    {active ? <div className="finance-tooltip"><strong>{active.label}</strong><span>Revenue <b>{formatter.format(active.revenue)}</b></span><span>COGS <b>-{formatter.format(active.cogs)}</b></span><span>Facebook ads <b>-{formatter.format(active.metaMarketing)}</b></span><span>Google Ads <b>-{formatter.format(active.googleMarketing)}</b></span><span>Microsoft Ads <b>-{formatter.format(active.bingMarketing)}</b></span><span>Payment fees <b>{active.paymentFeesAvailable ? `-${formatter.format(active.paymentFees)}` : "Not available"}</b></span><span>Shipping & handling <b>-{formatter.format(active.shipping)}</b></span><span>Operating costs <b>-{formatter.format(active.operating)}</b></span><span className="tooltip-profit">{active.complete ? "Net profit" : "Provisional profit"} <b>{formatter.format(active.profit)}</b></span></div> : null}
  </div>;
}

type OverviewData = {
  hasData: boolean;
  currency: string;
  timezone: string;
  currencyCoverage: CurrencyCoverage;
  marketingCurrencyCoverage: CurrencyConversionCoverage;
  range: { start: string; end: string };
  metrics: { grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number; unitsSold: number; averageOrderValue: number; marketingSpend: number; newCustomers: number; newCustomerSales: number; blendedCac: number | null; blendedMer: number | null; newCustomerRoas: number | null };
  months: Array<{ key: string; label: string; grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number }>;
  meta?: { importedDays: number; start: string | null; end: string | null };
  google?: { importedDays: number; start: string | null; end: string | null };
  bing?: { importedDays: number; start?: string | null; end?: string | null };
};

type ShopifyOverviewWidgets = { channels: Array<{ channel: string; sales: number; orders: number }>; products: Array<{ key: string; product: string; variant: string; units: number; netRevenue: number }>; customers: Array<{ label: string; sales: number; orders: number }> };

export function Overview({ reportRunId, onDrilldown, storageKey }: { reportRunId?: string; onDrilldown: (target: View, context?: DrilldownContext) => void; storageKey: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [liveData, setLiveData] = useState<OverviewData | null>(null);
  const [comparisonData, setComparisonData] = useState<OverviewData | null>(null);
  const [pnlSummary, setPnlSummary] = useState<PnlData | null>(null);
  const [pnlComparison, setPnlComparison] = useState<PnlData | null>(null);
  const [overviewProducts, setOverviewProducts] = useState<ProductData | null>(null);
  const [overviewCustomers, setOverviewCustomers] = useState<CustomerData | null>(null);
  const [overviewUtm, setOverviewUtm] = useState<UtmData | null>(null);
  const [shopifyWidgets, setShopifyWidgets] = useState<ShopifyOverviewWidgets | null>(null);
  const [shopifyWidgetError, setShopifyWidgetError] = useState("");
  const [fromDate, setFromDate] = useState(default365DayRange.from);
  const [toDate, setToDate] = useState(default365DayRange.to);
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>("last_365_days");
  const [granularity, setGranularity] = useState<ReportingGranularity>("monthly");
  const [trendData, setTrendData] = useState<PnlPeriodData[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [customizingWidgets, setCustomizingWidgets] = useState(false);
  const [widgetPreferences, setWidgetPreferences] = useState<{ order: OverviewWidgetId[]; hidden: OverviewWidgetId[] }>({ order: [...overviewWidgetIds], hidden: [] });
  const widgetPreferencesReady = useRef(false);
  const filterPreferencesReady = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("spine:overview-widgets");
        if (stored) {
          const parsed = JSON.parse(stored) as { order?: unknown; hidden?: unknown };
          const savedOrder = Array.isArray(parsed.order) ? parsed.order.filter((value): value is OverviewWidgetId => typeof value === "string" && overviewWidgetIds.includes(value as OverviewWidgetId)) : [];
          const order = [...new Set(savedOrder), ...overviewWidgetIds.filter((id) => !savedOrder.includes(id))];
          const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((value): value is OverviewWidgetId => typeof value === "string" && overviewWidgetIds.includes(value as OverviewWidgetId)) : [];
          setWidgetPreferences({ order, hidden: [...new Set(hidden)] });
        }
      } catch { window.localStorage.removeItem("spine:overview-widgets"); }
      widgetPreferencesReady.current = true;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!widgetPreferencesReady.current) return;
    window.localStorage.setItem("spine:overview-widgets", JSON.stringify(widgetPreferences));
  }, [widgetPreferences]);

  useEffect(() => {
    filterPreferencesReady.current = false;
    const timeout = window.setTimeout(() => {
      const key = `spine:overview-filters:${storageKey}`;
      try {
        const stored = window.localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored) as { fromDate?: unknown; toDate?: unknown; datePreset?: unknown; granularity?: unknown };
          const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
          const validPreset = typeof parsed.datePreset === "string" && ["today", "yesterday", "last_7_days", "last_7_complete_days", "last_30_days", "last_30_complete_days", "last_90_days", "last_365_days", "this_month", "last_month", "all_imported", "custom"].includes(parsed.datePreset);
          const validGranularity = typeof parsed.granularity === "string" && ["daily", "weekly", "monthly", "quarterly", "annual"].includes(parsed.granularity);
          if ((isDate(parsed.fromDate) || parsed.fromDate === "") && (isDate(parsed.toDate) || parsed.toDate === "") && validPreset && validGranularity) {
            setFromDate(parsed.fromDate as string);
            setToDate(parsed.toDate as string);
            setDatePreset(parsed.datePreset as FinanceDatePreset);
            setGranularity(parsed.granularity as ReportingGranularity);
          }
        }
      } catch { window.localStorage.removeItem(key); }
      filterPreferencesReady.current = true;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [storageKey]);

  useEffect(() => {
    if (!filterPreferencesReady.current) return;
    window.localStorage.setItem(`spine:overview-filters:${storageKey}`, JSON.stringify({ fromDate, toDate, datePreset, granularity }));
  }, [storageKey, fromDate, toDate, datePreset, granularity]);

  useResetOnChange((fromDate && !toDate) || (!fromDate && toDate) ? null : `${fromDate}|${toDate}|${retryToken}`, () => { setLoading(true); setLoadError(false); });
  useEffect(() => {
    if ((fromDate && !toDate) || (!fromDate && toDate)) return;
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const suffix = params.size ? `?${params}` : "";
    let comparisonSuffix: string | null = null;
    if (fromDate && toDate) {
      const start = new Date(`${fromDate}T00:00:00Z`);
      const end = new Date(`${toDate}T00:00:00Z`);
      const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      const previousEnd = new Date(start); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
      const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
      comparisonSuffix = `?from=${previousStart.toISOString().slice(0, 10)}&to=${previousEnd.toISOString().slice(0, 10)}`;
    }
    const utmSuffix = params.size ? `?attribution=last_touch&${params}` : "?attribution=last_touch";
    const urls: Array<string | null> = [
      `/api/analytics/overview${suffix}`,
      `/api/analytics/pnl${suffix}`,
      comparisonSuffix ? `/api/analytics/overview${comparisonSuffix}` : null,
      comparisonSuffix ? `/api/analytics/pnl${comparisonSuffix}` : null,
      `/api/analytics/products${suffix}`,
      `/api/analytics/customers${suffix}`,
      `/api/analytics/utm${utmSuffix}`,
    ];
    const controller = new AbortController();
    const show = (results: Array<unknown | null>) => {
      const [overview, pnl, comparison, previousPnl, productsData, customersData, utmData] = results;
      setLiveData(overview as OverviewData | null); setPnlSummary(pnl as PnlData | null);
      setComparisonData(comparison as OverviewData | null); setPnlComparison(previousPnl as PnlData | null);
      setOverviewProducts(productsData as ProductData | null); setOverviewCustomers(customersData as CustomerData | null); setOverviewUtm(utmData as UtmData | null);
      setLoadError(!overview);
    };
    void (async () => {
      // Paint the last real numbers immediately, then refresh behind them.
      const cached = await Promise.all(urls.map((url) => url ? peekJson<unknown>(url) : Promise.resolve(null)));
      if (controller.signal.aborted) return;
      if (cached[0]) {
        show(cached.map((entry) => entry?.data ?? null));
        setLoading(false);
        if (!cached.every((entry, index) => !urls[index] || entry?.fresh)) setRefreshing(true);
      }
      // One failed panel degrades to its cached copy (or nothing), as before.
      const results = await Promise.all(urls.map((url, index) => url ? fetchJson<unknown>(url, { signal: controller.signal }).catch(() => cached[index]?.data ?? null) : Promise.resolve(null)));
      if (controller.signal.aborted) return;
      show(results);
      const overview = results[0] as OverviewData | null;
      finishReportRun(overview ? "completed" : "failed", overview?.metrics.orders ?? null);
    })()
      .catch(() => {
        if (controller.signal.aborted) return;
        show([null, null, null, null, null, null, null]);
        setLoadError(true);
        finishReportRun("failed", null, "Overview data could not be loaded");
      })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); } });
    return () => controller.abort();
  }, [finishReportRun, fromDate, toDate, retryToken]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!pnlSummary?.period || !pnlSummary.hasData) { setTrendData([]); return; }
      const periodStart = fromDate || pnlSummary.period.start;
      const periodEnd = toDate || pnlSummary.period.end;
      const dailyDays = Math.floor((Date.parse(periodEnd + "T00:00:00Z") - Date.parse(periodStart + "T00:00:00Z")) / 86400000) + 1;
      const periods = reportingPeriods(periodStart, periodEnd, granularity, granularity === "daily" ? Math.max(dailyDays, 1) : 60);
      setTrendLoading(true);
      fetchPnlSeries(periods, controller.signal)
        .then((series) => {
          if (controller.signal.aborted) return;
          setTrendData(periods.flatMap((period): PnlPeriodData[] => {
            const data = series.get(pnlSeriesKey(period));
            return data ? [{ period, data }] : [];
          }));
        })
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setTrendData([]); })
        .finally(() => { if (!controller.signal.aborted) setTrendLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [fromDate, toDate, granularity, pnlSummary]);

  const hasLiveData = Boolean(liveData?.hasData);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: liveData?.currency || "GBP", maximumFractionDigits: 0 });
  const comparisonDelta = (current: number | null, previous: number | null | undefined, format: (value: number) => string, fallback: string, lowerIsBetter = false) => {
    if (current === null || previous === null || previous === undefined || !comparisonData) return { delta: fallback, positive: true };
    const change = current - previous;
    const percentage = previous === 0 ? null : change / Math.abs(previous) * 100;
    const signedValue = `${change > 0 ? "+" : ""}${format(change)}`;
    return { delta: `${signedValue}${percentage === null ? "" : ` (${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%)`}`, positive: lowerIsBetter ? change <= 0 : change >= 0 };
  };
  const moneyDelta = (current: number | null, previous: number | null | undefined, fallback: string, lowerIsBetter = false) => comparisonDelta(current, previous, (value) => formatter.format(value), fallback, lowerIsBetter);
  const countDelta = (current: number, previous: number | undefined, fallback: string) => comparisonDelta(current, previous, (value) => Math.round(value).toLocaleString(), fallback);
  const ratioDelta = (current: number | null, previous: number | null | undefined, fallback: string, lowerIsBetter = false) => comparisonDelta(current, previous, (value) => `${value.toFixed(2)}x`, fallback, lowerIsBetter);
  const displayedNetProfit = pnlSummary?.hasData ? pnlSummary.metrics.netProfit ?? pnlSummary.metrics.profitAfterMarketingSpend : null;
  const comparisonNetProfit = pnlComparison?.hasData ? pnlComparison.metrics.netProfit ?? pnlComparison.metrics.profitAfterMarketingSpend : null;
  const netProfitIsProvisional = displayedNetProfit !== null && !pnlSummary?.availability.netProfit;
  const netProfitDelta = moneyDelta(displayedNetProfit, comparisonNetProfit, "After known costs");
  const liveMetrics = liveData ? [
    { label: "Net sales", value: formatter.format(liveData.metrics.netSales), ...moneyDelta(liveData.metrics.netSales, comparisonData?.metrics.netSales, "Live Shopify data"), hint: `${liveData.metrics.orders.toLocaleString()} orders` },
    { label: "Orders", value: liveData.metrics.orders.toLocaleString(), ...countDelta(liveData.metrics.orders, comparisonData?.metrics.orders, "Imported Shopify orders"), hint: `${liveData.metrics.unitsSold.toLocaleString()} units sold` },
    { label: "Units sold", value: liveData.metrics.unitsSold.toLocaleString(), ...countDelta(liveData.metrics.unitsSold, comparisonData?.metrics.unitsSold, "Current quantities"), hint: `${liveData.metrics.orders ? (liveData.metrics.unitsSold / liveData.metrics.orders).toFixed(1) : "0.0"} units per order` },
    { label: "Average order value", value: formatter.format(liveData.metrics.averageOrderValue), ...moneyDelta(liveData.metrics.averageOrderValue, comparisonData?.metrics.averageOrderValue, "Net product sales"), hint: `${liveData.metrics.orders.toLocaleString()} completed orders` },
    { label: "Gross sales", value: formatter.format(liveData.metrics.grossSales), ...moneyDelta(liveData.metrics.grossSales, comparisonData?.metrics.grossSales, "Before discounts"), hint: `${formatter.format(liveData.metrics.discounts)} discounts` },
    { label: "Shipping revenue", value: formatter.format(liveData.metrics.shippingRevenue), ...moneyDelta(liveData.metrics.shippingRevenue, comparisonData?.metrics.shippingRevenue, "Shopify orders"), hint: "Excludes tax and duties" },
    { label: "Blended CAC", value: liveData.metrics.blendedCac === null ? "—" : formatter.format(liveData.metrics.blendedCac), ...moneyDelta(liveData.metrics.blendedCac, comparisonData?.metrics.blendedCac, "Ad spend ÷ new customers", true), hint: `${liveData.metrics.newCustomers.toLocaleString()} first-observed customers` },
    { label: "Blended MER", value: liveData.metrics.blendedMer === null ? "—" : `${liveData.metrics.blendedMer.toFixed(2)}x`, ...ratioDelta(liveData.metrics.blendedMer, comparisonData?.metrics.blendedMer, "Net sales ÷ ad spend"), hint: liveData.metrics.marketingSpend ? `${formatter.format(liveData.metrics.marketingSpend)} imported spend` : "Connect ad spend" },
    { label: "New-customer ROAS", value: liveData.metrics.newCustomerRoas === null ? "—" : `${liveData.metrics.newCustomerRoas.toFixed(2)}x`, ...ratioDelta(liveData.metrics.newCustomerRoas, comparisonData?.metrics.newCustomerRoas, "First observed order sales"), hint: "Uses Meta, Google and Microsoft spend for the imported window" },
    { label: "Gross profit", value: pnlSummary?.hasData ? formatter.format(pnlSummary.metrics.grossProfit) : "—", ...moneyDelta(pnlSummary?.hasData ? pnlSummary.metrics.grossProfit : null, pnlComparison?.hasData ? pnlComparison.metrics.grossProfit : null, "Net product sales less refunds and COGS"), hint: pnlSummary?.metrics.missingCostLines ? `${pnlSummary.metrics.missingCostLines.toLocaleString()} lines need costs` : "Product costs covered" },
    { label: "Marketing cost", value: pnlSummary?.availability.marketingSpend ? formatter.format(pnlSummary.metrics.marketingSpend) : "—", ...moneyDelta(pnlSummary?.availability.marketingSpend ? pnlSummary.metrics.marketingSpend : null, pnlComparison?.availability.marketingSpend ? pnlComparison.metrics.marketingSpend : null, "Imported ad spend", true), hint: pnlSummary?.availability.marketingSpend ? "Meta + Google + Microsoft Ads" : "Connect ad spend" },
    { label: "Postage cost", value: pnlSummary?.availability.shippingCosts ? formatter.format(pnlSummary.metrics.merchantShippingCosts) : "—", ...moneyDelta(pnlSummary?.availability.shippingCosts ? pnlSummary.metrics.merchantShippingCosts : null, pnlComparison?.availability.shippingCosts ? pnlComparison.metrics.merchantShippingCosts : null, "Delivery and product shipping costs", true), hint: pnlSummary?.availability.shippingCosts ? "Product overrides and store postage" : "Complete postage costs" },
    { label: "Warehouse fulfilment", value: pnlSummary?.availability.handlingCosts ? formatter.format(pnlSummary.metrics.handlingCosts) : "—", ...moneyDelta(pnlSummary?.availability.handlingCosts ? pnlSummary.metrics.handlingCosts : null, pnlComparison?.availability.handlingCosts ? pnlComparison.metrics.handlingCosts : null, "Fulfilment cost by order or unit", true), hint: pnlSummary?.availability.handlingCosts ? "Store fulfilment default applied" : "Set fulfilment cost" },
    { label: "Contribution margin", value: pnlSummary?.availability.marketingSpend && pnlSummary.availability.shippingCosts && pnlSummary.availability.handlingCosts ? formatter.format(pnlSummary.metrics.contributionMargin) : "—", ...moneyDelta(pnlSummary?.availability.marketingSpend && pnlSummary.availability.shippingCosts && pnlSummary.availability.handlingCosts ? pnlSummary.metrics.contributionMargin : null, pnlComparison?.availability.marketingSpend && pnlComparison.availability.shippingCosts && pnlComparison.availability.handlingCosts ? pnlComparison.metrics.contributionMargin : null, "After variable direct costs"), hint: pnlSummary?.availability.shippingCosts && pnlSummary?.availability.handlingCosts ? "Shipping and handling included" : "Complete shipping and handling costs" },
    { label: "Net profit", value: displayedNetProfit !== null ? formatter.format(displayedNetProfit) : "—", ...netProfitDelta, delta: netProfitIsProvisional ? "Provisional" : netProfitDelta.delta, hint: pnlSummary?.availability.netProfit ? `${pnlSummary.metrics.netMargin === null ? "—" : `${(pnlSummary.metrics.netMargin * 100).toFixed(1)}%`} net margin` : pnlSummary?.hasData ? "Known costs only · coverage incomplete" : "P&L data unavailable" },
  ] : [];
  const trendSeries: FinanceTrendPoint[] = trendData.map(({ period, data }) => {
    const reportRevenue = data.metrics.netProductSales - data.metrics.refunds;
    const reportProfit = data.metrics.netProfit ?? data.metrics.profitAfterMarketingSpend;
    return {
      label: period.label, start: period.start, end: period.end, revenue: reportRevenue, profit: reportProfit, complete: data.availability.netProfit,
      cogs: data.metrics.cogs,
      metaMarketing: data.metrics.metaMarketingSpend,
      googleMarketing: data.metrics.googleMarketingSpend,
      bingMarketing: data.metrics.bingMarketingSpend,
      paymentFees: data.metrics.transactionFees,
      paymentFeesAvailable: data.availability.transactionFees,
      shipping: data.metrics.merchantShippingCosts + data.metrics.handlingCosts,
      operating: data.metrics.operatingExpenses,
    };
  });
  useResetOnChange((fromDate && !toDate) || (!fromDate && toDate) ? null : `${fromDate}|${toDate}`, () => { setShopifyWidgets(null); setShopifyWidgetError(""); });
  useEffect(() => {
    if ((fromDate && !toDate) || (!fromDate && toDate)) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`/api/analytics/shopify-overview-widgets?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Shopify reports could not be loaded");
        setShopifyWidgets(payload as ShopifyOverviewWidgets);
      })
      .catch((error) => { if (!controller.signal.aborted) setShopifyWidgetError(error instanceof Error ? error.message : "Shopify reports could not be loaded"); });
    return () => controller.abort();
  }, [fromDate, toDate]);
  const channelPalette = ["#7357ff", "#18b981", "#ff9f43", "#37a3ff", "#e85d75"];
  const channelMap = new Map<string, { sales: number; orders: number }>();
  for (const row of overviewUtm?.rows ?? []) {
    const current = channelMap.get(row.channel) ?? { sales: 0, orders: 0 };
    current.sales += row.sales; current.orders += row.orders; channelMap.set(row.channel, current);
  }
  const channelRows = (shopifyWidgets?.channels ?? [...channelMap.entries()].map(([channel, values]) => ({ channel, ...values }))).sort((left, right) => right.sales - left.sales).slice(0, 5);
  const channelSales = channelRows.reduce((total, row) => total + row.sales, 0);
  const topProducts = shopifyWidgets?.products.map((item) => ({ ...item, missingCostUnits: 1, contributionProfit: 0 })) ?? overviewProducts?.products.slice(0, 5) ?? [];
  const customerSplit = shopifyWidgets?.customers ?? (overviewCustomers ? [
    { label: "New", sales: overviewCustomers.metrics.newCustomerSales, orders: overviewCustomers.metrics.newCustomerOrders },
    { label: "Repeat", sales: overviewCustomers.metrics.repeatCustomerSales, orders: overviewCustomers.metrics.repeatCustomerOrders },
    { label: "Guest", sales: overviewCustomers.metrics.guestSales, orders: overviewCustomers.metrics.guestOrders },
  ] : []);
  const customerSales = customerSplit.reduce((total, row) => total + row.sales, 0);
  const costBreakdown = pnlSummary ? [
    { label: "Product COGS", amount: pnlSummary.metrics.cogs },
    { label: "Marketing", amount: pnlSummary.metrics.marketingSpend },
    { label: "Payment fees", amount: pnlSummary.metrics.transactionFees },
    { label: "Shipping & handling", amount: pnlSummary.metrics.merchantShippingCosts + pnlSummary.metrics.handlingCosts },
    { label: "Operating expenses", amount: pnlSummary.metrics.operatingExpenses },
  ].filter((row) => row.amount > 0) : [];
  const totalKnownCosts = costBreakdown.reduce((total, row) => total + row.amount, 0);
  const exportOverview = () => {
    if (!liveData?.hasData) return;
    downloadCsv("shopify-overview.csv", [
      ["Report", "Shopify overview"],
      ["Period", `${liveData.range.start} to ${liveData.range.end}`],
      ["Timezone", liveData.timezone],
      ["Currency", liveData.currency],
      ["Generated at", new Date().toISOString()],
      [],
      ["Metric", "Value"],
      ["Net sales", liveData.metrics.netSales],
      ["Gross sales", liveData.metrics.grossSales],
      ["Discounts", liveData.metrics.discounts],
      ["Shipping revenue", liveData.metrics.shippingRevenue],
      ["Orders", liveData.metrics.orders],
      ["Units sold", liveData.metrics.unitsSold],
      ["Average order value", liveData.metrics.averageOrderValue],
      ["Marketing spend", liveData.metrics.marketingSpend],
      ["New customers", liveData.metrics.newCustomers],
      ["New-customer sales", liveData.metrics.newCustomerSales],
      ["Blended CAC", liveData.metrics.blendedCac ?? "Unavailable"],
      ["Blended MER", liveData.metrics.blendedMer ?? "Unavailable"],
      ["New-customer ROAS", liveData.metrics.newCustomerRoas ?? "Unavailable"],
      [],
      ["Month", "Net sales", "Gross sales", "Discounts", "Shipping revenue", "Orders"],
      ...liveData.months.map((month) => [month.label, month.netSales, month.grossSales, month.discounts, month.shippingRevenue, month.orders]),
    ]);
  };
  const drilldownRange = liveData ? { from: fromDate || liveData.range.start, to: toDate || liveData.range.end } : undefined;
  const metricReport = (label: string): View => /CAC|MER|ROAS|Marketing/.test(label) ? "UTM Analysis" : "Profit & Loss";
  const widgetOrder = (id: OverviewWidgetId) => 2 + widgetPreferences.order.indexOf(id);
  const widgetVisible = (id: OverviewWidgetId) => !widgetPreferences.hidden.includes(id);
  const moveWidget = (id: OverviewWidgetId, direction: -1 | 1) => setWidgetPreferences((current) => {
    const index = current.order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.order.length) return current;
    const order = [...current.order];
    [order[index], order[target]] = [order[target], order[index]];
    return { ...current, order };
  });
  const toggleWidget = (id: OverviewWidgetId) => setWidgetPreferences((current) => ({ ...current, hidden: current.hidden.includes(id) ? current.hidden.filter((item) => item !== id) : [...current.hidden, id] }));
  const resetWidgets = () => setWidgetPreferences({ order: [...overviewWidgetIds], hidden: [] });

  const applyDatePreset = (preset: FinanceDatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = financeDateRange(preset);
    setLoading(true); setFromDate(range.from); setToDate(range.to);
  };

  return <>
    <section className="filter-row pnl-period finance-date-controls"><label>Period<select aria-label="Date period" value={datePreset} onChange={(event) => applyDatePreset(event.target.value as FinanceDatePreset)}><option value="last_7_days">Last 7 days (today)</option><option value="last_7_complete_days">Last 7 complete days</option><option value="last_30_days">Last 30 days (today)</option><option value="last_30_complete_days">Last 30 complete days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option></select></label><label>From<input type="date" value={fromDate} onChange={(event) => { setDatePreset("custom"); setLoading(true); setFromDate(event.target.value); }}/></label><label>To<input type="date" value={toDate} onChange={(event) => { setDatePreset("custom"); setLoading(true); setToDate(event.target.value); }}/></label><label>Group by<select aria-label="Overview trend granularity" value={granularity} onChange={(event) => setGranularity(event.target.value as ReportingGranularity)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>{fromDate && toDate ? <span className="report-note">Compared with the immediately preceding period.</span> : null}</section>
    {trendLoading && !loading ? <PanelState status="loading" message="Calculating trend periods…"/> : null}
    <UpdatingChip show={refreshing}/>
    {!loading && loadError ? <PanelState status="error" title="Your Shopify summary could not be loaded" message="Check your connection and try again." onRetry={() => setRetryToken((token) => token + 1)}/> : null}
    {!loading && !loadError && !hasLiveData && liveData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to start your live dashboard</strong><span>Live sales and orders will appear here after your first sync.</span></div></div> : null}
    {liveData?.currencyCoverage.convertedOrders ? <div className="connection-notice"><Info/><div><strong>{liveData.currencyCoverage.convertedOrders.toLocaleString()} orders converted to {liveData.currency}</strong><span>Historical rates applied: {liveData.currencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}.</span></div></div> : null}{liveData?.currencyCoverage.excludedOrders ? <div className="connection-notice"><Info/><div><strong>{liveData.currencyCoverage.excludedOrders.toLocaleString()} orders excluded from financial totals</strong><span>Reporting currency is {liveData.currency}. Excluded: {liveData.currencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}. Add explicit exchange rates before consolidating these orders.</span></div></div> : null}{liveData?.marketingCurrencyCoverage.convertedRows ? <div className="connection-notice"><Info/><div><strong>{liveData.marketingCurrencyCoverage.convertedRows.toLocaleString()} advertising spend rows converted to {liveData.currency}</strong><span>Historical rates applied: {liveData.marketingCurrencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}{liveData?.marketingCurrencyCoverage.excludedRows ? <div className="connection-notice"><Info/><div><strong>{liveData.marketingCurrencyCoverage.excludedRows.toLocaleString()} advertising spend rows excluded</strong><span>Missing dated rates: {liveData.marketingCurrencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}
    <div className="report-export">{hasLiveData ? <button className="export-button" onClick={exportOverview}><Download/> Export overview CSV</button> : null}<button className="export-button" onClick={() => setCustomizingWidgets((current) => !current)}><Settings/> {customizingWidgets ? "Done customizing" : "Customize dashboard"}</button></div>
    {customizingWidgets ? <section className="widget-customizer" aria-label="Dashboard widget settings"><div><strong>Summary widgets</strong><span>Choose what appears and arrange the reading order.</span></div><div className="widget-customizer-list">{widgetPreferences.order.map((id, index) => <div className="widget-customizer-row" key={id}><label><input type="checkbox" checked={widgetVisible(id)} onChange={() => toggleWidget(id)}/><span>{overviewWidgetLabels[id]}</span></label><div><button type="button" disabled={index === 0} onClick={() => moveWidget(id, -1)} aria-label={`Move ${overviewWidgetLabels[id]} earlier`}>↑</button><button type="button" disabled={index === widgetPreferences.order.length - 1} onClick={() => moveWidget(id, 1)} aria-label={`Move ${overviewWidgetLabels[id]} later`}>↓</button></div></div>)}</div><button type="button" className="panel-drilldown" onClick={resetWidgets}>Restore defaults</button></section> : null}
    <section className="metric-grid">{loading ? Array.from({ length: 14 }, (_, index) => <StatCardSkeleton key={index}/>) : liveMetrics.map((metric) => <button type="button" className="metric-card drilldown-card" key={metric.label} onClick={() => onDrilldown(metricReport(metric.label), drilldownRange)} aria-label={`Open ${metric.label} details`}>
      <div className="metric-head"><span>{metric.label}</span><ExternalLink /></div>
      <strong>{metric.value}</strong>
      <div className="metric-foot"><Trend positive={metric.positive} neutral={metric.label === "Net profit" && netProfitIsProvisional}>{metric.delta}</Trend><span>{metric.hint}</span></div>
    </button>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel finance-chart-panel" style={{ order: 0 }}>
        <div className="panel-head"><div><span className="eyebrow">PERFORMANCE</span><h2>Revenue, costs and profit</h2></div><div className="finance-legend"><span><i className="legend-revenue"/>Revenue</span><span><i className="legend-cogs"/>COGS</span><span><i className="legend-meta"/>Facebook</span><span><i className="legend-google"/>Google</span><span><i className="legend-microsoft"/>Microsoft Ads</span><span><i className="legend-fees"/>Fees</span><span><i className="legend-shipping"/>Shipping</span><span><i className="legend-operating"/>Operating</span><span><i className="legend-profit"/>Profit</span></div></div>
        <FinanceTrendChart points={trendSeries} formatter={formatter} onOpen={(point) => onDrilldown("Profit & Loss", { from: point.start, to: point.end })}/>
        {trendSeries.some((point) => !point.complete) ? <span className="report-note">Profit is provisional where cost coverage is incomplete. Hover a period for the full revenue and cost bridge.</span> : null}
      </article>
      <article className="panel health-panel" style={{ order: 1 }}><div className="panel-head"><div><span className="eyebrow">DATA HEALTH</span><h2>{hasLiveData ? "Imported store data" : "Store readiness"}</h2></div><span className="score">{hasLiveData ? "LIVE" : "86%"}</span></div>
        <div className="health-ring"><div><strong>{hasLiveData ? liveData!.metrics.orders.toLocaleString() : "86"}</strong><span>{hasLiveData ? "orders" : "Good"}</span></div></div>
        {hasLiveData ? <ul className="health-list"><li><span className="status success"/>Shopify sales loaded <b>{liveData!.metrics.orders.toLocaleString()} orders</b></li><li><span className="status success"/>Data window <b>{liveData!.range.start} – {liveData!.range.end}</b></li><li><span className={(liveData!.meta?.importedDays || liveData!.google?.importedDays || liveData!.bing?.importedDays) ? "status success" : "status warn"}/>Marketing spend <b>{(liveData!.meta?.importedDays || liveData!.google?.importedDays || liveData!.bing?.importedDays) ? `${liveData!.meta?.importedDays ?? 0} Meta days · ${liveData!.google?.importedDays ?? 0} Google days · ${liveData!.bing?.importedDays ?? 0} Microsoft days` : "No spend loaded"}</b></li></ul> : <ul className="health-list"><li><span className="status success"/>Shopify synced <b>2m ago</b></li><li><span className="status success"/>Ad accounts connected <b>2 of 2</b></li><li><span className="status warn"/>Missing product costs <b>14 SKUs</b></li></ul>}
      </article>
      {widgetVisible("channel") ? <article className="panel channel-panel" style={{ order: widgetOrder("channel") }}><div className="panel-head"><div><span className="eyebrow">ACQUISITION</span><h2>Channel mix</h2></div><button className="panel-drilldown" onClick={() => onDrilldown("UTM Analysis", drilldownRange)}>View report <ExternalLink/></button></div>
        {channelRows.length ? <div className="channel-table"><div className="channel-row header"><span>Channel</span><span>Orders</span><span>Revenue</span><span>Share</span><span>Revenue mix</span></div>{channelRows.map((channel, index) => { const share = channelSales ? channel.sales / channelSales * 100 : 0; const color = channelPalette[index % channelPalette.length]; return <div className="channel-row" key={channel.channel}><span className="channel-name"><i style={{background:color}}/>{channel.channel}</span><span>{channel.orders.toLocaleString()}</span><strong>{formatter.format(channel.sales)}</strong><span>{share.toFixed(1)}%</span><span className="mix"><i style={{width:`${share}%`, background:color}}/></span></div>; })}</div> : <div className="cost-empty"><Megaphone/><strong>No attributed orders in this period</strong><span>{shopifyWidgetError || "Shopify reported no referrer data for these dates."}</span></div>}
      </article> : null}
      {widgetVisible("products") ? <article className="panel report-panel" style={{ order: widgetOrder("products") }}><div className="panel-head"><div><span className="eyebrow">PRODUCTS</span><h2>Top products by net revenue</h2></div><button className="panel-drilldown" onClick={() => onDrilldown("Products", drilldownRange)}>View report <ExternalLink/></button></div>{topProducts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Product</th><th>Units</th><th>Net revenue</th><th>Share of top five</th></tr></thead><tbody>{topProducts.map((product) => <tr key={product.key}><td><strong>{product.product}</strong><small>{product.variant}</small></td><td>{product.units.toLocaleString()}</td><td>{formatter.format(product.netRevenue)}</td><td>{topProducts.reduce((total, item) => total + Math.max(0, item.netRevenue), 0) ? `${(Math.max(0, product.netRevenue) / topProducts.reduce((total, item) => total + Math.max(0, item.netRevenue), 0) * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><Package/><strong>No product sales in this period</strong><span>{shopifyWidgetError}</span></div>}</article> : null}
      {widgetVisible("customers") ? <article className="panel report-panel" style={{ order: widgetOrder("customers") }}><div className="panel-head"><div><span className="eyebrow">CUSTOMERS</span><h2>Customer sales split</h2></div><button className="panel-drilldown" onClick={() => onDrilldown("Customers", drilldownRange)}>View report <ExternalLink/></button></div>{customerSplit.length ? <div className="report-summary">{customerSplit.map((row) => <div key={row.label}><span>{row.label}</span><strong>{formatter.format(row.sales)}</strong><small>{row.orders.toLocaleString()} orders · {customerSales ? (row.sales / customerSales * 100).toFixed(1) : "0.0"}%</small></div>)}</div> : <div className="cost-empty"><Users/><strong>No customer sales in this period</strong><span>{shopifyWidgetError}</span></div>}</article> : null}
      {widgetVisible("costs") ? <article className="panel report-panel" style={{ order: widgetOrder("costs") }}><div className="panel-head"><div><span className="eyebrow">COSTS</span><h2>Known cost breakdown</h2></div><button className="panel-drilldown" onClick={() => onDrilldown("Profit & Loss", drilldownRange)}>View report <ExternalLink/></button></div>{costBreakdown.length ? <div className="report-summary">{costBreakdown.map((row) => <div key={row.label}><span>{row.label}</span><strong>{formatter.format(row.amount)}</strong><small>{totalKnownCosts ? (row.amount / totalKnownCosts * 100).toFixed(1) : "0.0"}% of known costs</small></div>)}</div> : <div className="cost-empty"><WalletCards/><strong>No cost data in this period</strong></div>}</article> : null}
      <article className="panel activity-panel" style={{ order: 10 }}><div className="panel-head"><div><span className="eyebrow">NEXT STEPS</span><h2>{hasLiveData ? "Complete your profit picture" : "Profit opportunities"}</h2></div></div>
        {hasLiveData ? <><div className="opportunity"><span className="opp-icon purple"><WalletCards/></span><div><strong>Add effective-dated product costs</strong><p>Product profitability becomes more precise as cost coverage improves.</p></div></div><div className="opportunity"><span className="opp-icon green"><Megaphone/></span><div><strong>Review your UTM analysis</strong><p>See the sources, mediums, and campaigns attached to imported orders.</p></div></div><div className="opportunity"><span className="opp-icon orange"><CircleDollarSign/></span><div><strong>Connect marketing spend</strong><p>ROAS and final net profit need trusted campaign spend and merchant shipping costs.</p></div></div></> : <><div className="opportunity"><span className="opp-icon purple"><Sparkles/></span><div><strong>14 products need costs</strong><p>£8,420 revenue has unknown margin.</p></div><button>Add costs</button></div><div className="opportunity"><span className="opp-icon green"><TrendingUp/></span><div><strong>Google Brand is outperforming</strong><p>ROAS improved 22% this period.</p></div><button>Explore</button></div><div className="opportunity"><span className="opp-icon orange"><Megaphone/></span><div><strong>Campaign naming mismatch</strong><p>3 campaigns need UTM mapping.</p></div><button>Fix</button></div></>}
      </article>
    </section>
  </>;
}
