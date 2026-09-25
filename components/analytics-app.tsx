"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ShopifyCustomerReport } from "@/components/shopify-customer-report";
import { ProductJourneyChart } from "@/components/product-journey-chart";
import { LeadOverview } from "@/components/lead-overview";
import { LeadReportPage } from "@/components/lead-report-page";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { reportingPeriods, type ReportingGranularity, type ReportingPeriod } from "@/lib/analytics/reporting-periods";
import { buildCampaignUrl } from "@/lib/analytics/utm-builder";
import { fetchCachedJson } from "@/lib/analytics/client-response-cache";
import { calculateProfitPerNewCustomer } from "@/lib/analytics/customer-profit";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { starterReports } from "@/lib/reports/starter-templates";
import {
  buildCustomSpendRows,
  customSpendColumnFields,
  parseCustomSpendCsv,
  type CustomSpendColumnKey,
  type ParsedCustomSpendCsv,
  type CustomSpendInputRow,
} from "@/lib/settings/custom-spend-csv";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown,
  CircleDollarSign, Database, Download, Eye, EyeOff, ExternalLink, FileBarChart, Info, KeyRound, LayoutDashboard,
  LogOut, Megaphone, Menu, Package, PhoneCall, Plus, RefreshCw, Search, Settings,
  ShoppingBag, Sparkles, Table2, TrendingUp, Upload, Users, WalletCards, X, Trash2,
} from "lucide-react";

type View = "Overview" | "Profit & Loss" | "Sales" | "UTM Analysis" | "Products" | "Leads" | "Pipeline outcomes" | "Stage ageing" | "Lead sources" | "Sales team" | "Forecast" | "Lost reasons" | "Follow-ups" | "Customers" | "Customer cohorts" | "Repurchase rates" | "Time between orders" | "Product journeys" | "New versus repeat sales" | "Top Shopify customers" | "Sales by country" | "Costs" | "Expenses" | "Reports" | "Connections" | "Settings";
type CustomerFocus = "summary" | "cohorts" | "repurchase" | "timing" | "journeys" | "sales" | "top-customers";
type DrilldownContext = { from?: string; to?: string; search?: string; source?: string; medium?: string; campaign?: string; landingPage?: string; customerType?: string; country?: string; product?: string; comparisonMode?: "previous_period" | "previous_year"; attributionModel?: "first_touch" | "last_touch" };
type OverviewWidgetId = "channel" | "products" | "customers" | "costs";
const overviewWidgetIds: OverviewWidgetId[] = ["channel", "products", "customers", "costs"];
const overviewWidgetLabels: Record<OverviewWidgetId, string> = { channel: "Channel mix", products: "Top products", customers: "Customer split", costs: "Cost breakdown" };
const default365DayRange = (() => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
})();

type FinanceDatePreset = "today" | "yesterday" | "last_7_days" | "last_7_complete_days" | "last_30_days" | "last_30_complete_days" | "last_90_days" | "last_365_days" | "this_month" | "last_month" | "all_imported" | "custom";

function financeDateRange(preset: FinanceDatePreset) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const rangeEnding = (days: number, endDate = end) => {
    const start = new Date(endDate);
    start.setUTCDate(start.getUTCDate() - days + 1);
    return { from: iso(start), to: iso(endDate) };
  };
  if (preset === "all_imported" || preset === "custom") return { from: "", to: "" };
  if (preset === "today") return { from: iso(end), to: iso(end) };
  if (preset === "yesterday") { const day = new Date(end); day.setUTCDate(day.getUTCDate() - 1); return { from: iso(day), to: iso(day) }; }
  if (preset === "last_7_complete_days" || preset === "last_30_complete_days") {
    const yesterday = new Date(end); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return rangeEnding(preset === "last_7_complete_days" ? 7 : 30, yesterday);
  }
  if (preset === "this_month") return { from: iso(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))), to: iso(end) };
  if (preset === "last_month") {
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
    return { from: iso(new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1))), to: iso(lastDay) };
  }
  const days = preset === "last_7_days" ? 7 : preset === "last_30_days" ? 30 : preset === "last_90_days" ? 90 : 365;
  return rangeEnding(days);
}

function FinanceDateControls({ preset, from, to, onPreset, onFrom, onTo, groupBy, onGroupBy }: {
  preset: FinanceDatePreset; from: string; to: string;
  onPreset: (value: FinanceDatePreset) => void; onFrom: (value: string) => void; onTo: (value: string) => void;
  groupBy?: ReportingGranularity; onGroupBy?: (value: ReportingGranularity) => void;
}) {
  return <section className="filter-row pnl-period finance-date-controls">
    <label>Period<select aria-label="Reporting period" value={preset} onChange={(event) => onPreset(event.target.value as FinanceDatePreset)}>
      <option value="last_7_days">Last 7 days (today)</option><option value="last_7_complete_days">Last 7 complete days</option>
      <option value="last_30_days">Last 30 days (today)</option><option value="last_30_complete_days">Last 30 complete days</option>
      <option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option>
      <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This month</option>
      <option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option>
    </select></label>
    <label>From<input type="date" value={from} onChange={(event) => onFrom(event.target.value)}/></label>
    <label>To<input type="date" value={to} onChange={(event) => onTo(event.target.value)}/></label>
    {groupBy && onGroupBy ? <label>Group by<select aria-label="Reporting group by" value={groupBy} onChange={(event) => onGroupBy(event.target.value as ReportingGranularity)}>
      <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
      <option value="quarterly">Quarterly</option><option value="annual">Annually</option>
    </select></label> : null}
  </section>;
}

type NavigationItem = { label: View; display?: string; icon: typeof LayoutDashboard; section?: string; subItem?: boolean };

const ecommerceNav: NavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Profit & Loss", icon: FileBarChart, section: "REPORTING" },
  { label: "Sales", icon: ShoppingBag },
  { label: "UTM Analysis", icon: Megaphone },
  { label: "Products", icon: Package },
  { label: "Customers", icon: Users },
  { label: "Customer cohorts", icon: Users, subItem: true },
  { label: "Repurchase rates", icon: Users, subItem: true },
  { label: "Time between orders", icon: Users, subItem: true },
  { label: "Product journeys", icon: Users, subItem: true },
  { label: "New versus repeat sales", icon: BarChart3, subItem: true },
  { label: "Top Shopify customers", icon: Users, subItem: true },
  { label: "Sales by country", icon: BarChart3, subItem: true },
  { label: "Costs", icon: WalletCards, section: "DATA" },
  { label: "Expenses", icon: WalletCards },
  { label: "Reports", icon: Table2 },
  { label: "Connections", icon: Database },
  { label: "Settings", icon: Settings, section: "MANAGE" },
];

const leadGenerationNav: NavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Leads", icon: PhoneCall, section: "LEAD GENERATION" },
  { label: "Pipeline outcomes", icon: BarChart3, section: "DEEP DIVES" },
  { label: "Stage ageing", icon: CalendarDays },
  { label: "Lead sources", icon: Megaphone },
  { label: "Sales team", icon: Users },
  { label: "Forecast", icon: TrendingUp },
  { label: "Lost reasons", icon: ArrowDownRight },
  { label: "Follow-ups", icon: PhoneCall },
  { label: "Connections", icon: Database, section: "INTEGRATIONS" },
  { label: "Settings", icon: Settings, section: "MANAGE" },
];

const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
const revenue = [68, 79, 72, 91, 83, 100];
const profit = [42, 48, 45, 57, 51, 66];
const spend = [16, 20, 18, 24, 23, 29];

const demoMetrics = [
  { label: "Net sales", value: "£258,592", delta: "+12.4%", positive: true, hint: "vs previous period" },
  { label: "Gross profit", value: "£144,812", delta: "+9.8%", positive: true, hint: "56.0% margin" },
  { label: "Marketing spend", value: "£27,911", delta: "+4.1%", positive: false, hint: "10.8% of sales" },
  { label: "Net profit", value: "£92,917", delta: "+18.2%", positive: true, hint: "35.9% margin" },
];

const utms = [
  ["facebook", "paid_social", "summer_scaling", "£64,820", "92", "£704", "6.8x"],
  ["google", "cpc", "brand_uk", "£41,340", "71", "£582", "9.2x"],
  ["klaviyo", "email", "product_launch", "£27,850", "43", "£648", "24.1x"],
  ["instagram", "organic", "bio_link", "£18,620", "29", "£642", "—"],
  ["(direct)", "(none)", "—", "£51,420", "84", "£612", "—"],
];

function Trend({ positive = true, children }: { positive?: boolean; children: React.ReactNode }) {
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <span className={positive ? "trend up" : "trend down"}><Icon />{children}</span>;
}

type FinanceTrendPoint = {
  label: string; start: string; end: string; revenue: number; profit: number; complete: boolean;
  cogs: number; metaMarketing: number; googleMarketing: number; paymentFees: number; shipping: number; operating: number;
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
    ...points.map((point) => point.cogs + point.metaMarketing + point.googleMarketing + point.paymentFees + point.shipping + point.operating),
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
  const costColors = ["#f59e0b", "#1877f2", "#34a853", "#a855f7", "#06b6d4", "#64748b"];
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
        const costs = [point.cogs, point.metaMarketing, point.googleMarketing, point.paymentFees, point.shipping, point.operating];
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
    {active ? <div className="finance-tooltip"><strong>{active.label}</strong><span>Revenue <b>{formatter.format(active.revenue)}</b></span><span>COGS <b>-{formatter.format(active.cogs)}</b></span><span>Facebook ads <b>-{formatter.format(active.metaMarketing)}</b></span><span>Google Ads <b>-{formatter.format(active.googleMarketing)}</b></span><span>Payment fees <b>-{formatter.format(active.paymentFees)}</b></span><span>Shipping & handling <b>-{formatter.format(active.shipping)}</b></span><span>Operating costs <b>-{formatter.format(active.operating)}</b></span><span className="tooltip-profit">{active.complete ? "Net profit" : "Provisional profit"} <b>{formatter.format(active.profit)}</b></span></div> : null}
  </div>;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function useReportRun(reportRunId?: string) {
  const finishedRun = useRef<string | null>(null);
  return useCallback((status: "completed" | "failed", rowCount: number | null = null, errorMessage: string | null = null) => {
    if (!reportRunId || finishedRun.current === reportRunId) return;
    finishedRun.current = reportRunId;
    void fetch("/api/reports/runs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: reportRunId, status, rowCount, errorMessage }),
    });
  }, [reportRunId]);
}

type CurrencyCoverage = { reportingCurrency: string; includedOrders: number; convertedOrders: number; excludedOrders: number; convertedCurrencies: Array<{ currency: string; orders: number }>; excludedCurrencies: Array<{ currency: string; orders: number }> };
type CurrencyConversionCoverage = { reportingCurrency: string; includedRows: number; convertedRows: number; excludedRows: number; convertedCurrencies: Array<{ currency: string; rows: number }>; excludedCurrencies: Array<{ currency: string; rows: number }> };

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
};

type ShopifyOverviewWidgets = { channels: Array<{ channel: string; sales: number; orders: number }>; products: Array<{ key: string; product: string; variant: string; units: number; netRevenue: number }>; customers: Array<{ label: string; sales: number; orders: number }> };

function Overview({ reportRunId, onDrilldown, storageKey }: { reportRunId?: string; onDrilldown: (target: View, context?: DrilldownContext) => void; storageKey: string }) {
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
    Promise.all([
      fetch(`/api/analytics/overview${suffix}`).then(async (response) => response.ok ? response.json() as Promise<OverviewData> : null),
      fetch(`/api/analytics/pnl${suffix}`).then(async (response) => response.ok ? response.json() as Promise<PnlData> : null),
      comparisonSuffix ? fetch(`/api/analytics/overview${comparisonSuffix}`).then(async (response) => response.ok ? response.json() as Promise<OverviewData> : null) : Promise.resolve(null),
      comparisonSuffix ? fetch(`/api/analytics/pnl${comparisonSuffix}`).then(async (response) => response.ok ? response.json() as Promise<PnlData> : null) : Promise.resolve(null),
      fetch(`/api/analytics/products${suffix}`).then(async (response) => response.ok ? response.json() as Promise<ProductData> : null),
      fetch(`/api/analytics/customers${suffix}`).then(async (response) => response.ok ? response.json() as Promise<CustomerData> : null),
      fetch(`/api/analytics/utm${utmSuffix}`).then(async (response) => response.ok ? response.json() as Promise<UtmData> : null),
    ])
      .then(([overview, pnl, comparison, previousPnl, productsData, customersData, utmData]) => {
        setLiveData(overview); setPnlSummary(pnl); setComparisonData(comparison); setPnlComparison(previousPnl);
        setOverviewProducts(productsData); setOverviewCustomers(customersData); setOverviewUtm(utmData);
        finishReportRun(overview ? "completed" : "failed", overview?.metrics.orders ?? null);
      })
      .catch(() => {
        setLiveData(null); setPnlSummary(null); setComparisonData(null); setPnlComparison(null);
        setOverviewProducts(null); setOverviewCustomers(null); setOverviewUtm(null);
        finishReportRun("failed", null, "Overview data could not be loaded");
      })
      .finally(() => setLoading(false));
  }, [finishReportRun, fromDate, toDate]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!pnlSummary?.period || !pnlSummary.hasData) { setTrendData([]); return; }
      const periods = reportingPeriods(pnlSummary.period.start, pnlSummary.period.end, granularity, granularity === "daily" ? 31 : 60);
      setTrendLoading(true);
      Promise.all(periods.map(async (period) => {
        if (period.start === pnlSummary.period?.start && period.end === pnlSummary.period?.end) return { period, data: pnlSummary };
        const response = await fetch(`/api/analytics/pnl?from=${period.start}&to=${period.end}`, { signal: controller.signal });
        return response.ok ? { period, data: await response.json() as PnlData } : null;
      }))
        .then((results) => setTrendData(results.filter((result): result is PnlPeriodData => result !== null)))
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setTrendData([]); })
        .finally(() => { if (!controller.signal.aborted) setTrendLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [granularity, pnlSummary]);

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
  const liveMetrics = liveData ? [
    { label: "Net sales", value: formatter.format(liveData.metrics.netSales), ...moneyDelta(liveData.metrics.netSales, comparisonData?.metrics.netSales, "Live Shopify data"), hint: `${liveData.metrics.orders.toLocaleString()} orders` },
    { label: "Orders", value: liveData.metrics.orders.toLocaleString(), ...countDelta(liveData.metrics.orders, comparisonData?.metrics.orders, "Imported Shopify orders"), hint: `${liveData.metrics.unitsSold.toLocaleString()} units sold` },
    { label: "Units sold", value: liveData.metrics.unitsSold.toLocaleString(), ...countDelta(liveData.metrics.unitsSold, comparisonData?.metrics.unitsSold, "Current quantities"), hint: `${liveData.metrics.orders ? (liveData.metrics.unitsSold / liveData.metrics.orders).toFixed(1) : "0.0"} units per order` },
    { label: "Average order value", value: formatter.format(liveData.metrics.averageOrderValue), ...moneyDelta(liveData.metrics.averageOrderValue, comparisonData?.metrics.averageOrderValue, "Net product sales"), hint: `${liveData.metrics.orders.toLocaleString()} completed orders` },
    { label: "Gross sales", value: formatter.format(liveData.metrics.grossSales), ...moneyDelta(liveData.metrics.grossSales, comparisonData?.metrics.grossSales, "Before discounts"), hint: `${formatter.format(liveData.metrics.discounts)} discounts` },
    { label: "Shipping revenue", value: formatter.format(liveData.metrics.shippingRevenue), ...moneyDelta(liveData.metrics.shippingRevenue, comparisonData?.metrics.shippingRevenue, "Shopify orders"), hint: "Excludes tax and duties" },
    { label: "Blended CAC", value: liveData.metrics.blendedCac === null ? "—" : formatter.format(liveData.metrics.blendedCac), ...moneyDelta(liveData.metrics.blendedCac, comparisonData?.metrics.blendedCac, "Ad spend ÷ new customers", true), hint: `${liveData.metrics.newCustomers.toLocaleString()} first-observed customers` },
    { label: "Blended MER", value: liveData.metrics.blendedMer === null ? "—" : `${liveData.metrics.blendedMer.toFixed(2)}x`, ...ratioDelta(liveData.metrics.blendedMer, comparisonData?.metrics.blendedMer, "Net sales ÷ ad spend"), hint: liveData.metrics.marketingSpend ? `${formatter.format(liveData.metrics.marketingSpend)} imported spend` : "Connect ad spend" },
    { label: "New-customer ROAS", value: liveData.metrics.newCustomerRoas === null ? "—" : `${liveData.metrics.newCustomerRoas.toFixed(2)}x`, ...ratioDelta(liveData.metrics.newCustomerRoas, comparisonData?.metrics.newCustomerRoas, "First observed order sales"), hint: "Uses combined Meta and Google spend for the imported window" },
    { label: "Gross profit", value: pnlSummary?.hasData ? formatter.format(pnlSummary.metrics.grossProfit) : "—", ...moneyDelta(pnlSummary?.hasData ? pnlSummary.metrics.grossProfit : null, pnlComparison?.hasData ? pnlComparison.metrics.grossProfit : null, "Net product sales less refunds and COGS"), hint: pnlSummary?.metrics.missingCostLines ? `${pnlSummary.metrics.missingCostLines.toLocaleString()} lines need costs` : "Product costs covered" },
    { label: "Marketing cost", value: pnlSummary?.availability.marketingSpend ? formatter.format(pnlSummary.metrics.marketingSpend) : "—", ...moneyDelta(pnlSummary?.availability.marketingSpend ? pnlSummary.metrics.marketingSpend : null, pnlComparison?.availability.marketingSpend ? pnlComparison.metrics.marketingSpend : null, "Imported ad spend", true), hint: pnlSummary?.availability.marketingSpend ? "Meta + Google Ads" : "Connect ad spend" },
    { label: "Postage cost", value: pnlSummary?.availability.shippingCosts ? formatter.format(pnlSummary.metrics.merchantShippingCosts) : "—", ...moneyDelta(pnlSummary?.availability.shippingCosts ? pnlSummary.metrics.merchantShippingCosts : null, pnlComparison?.availability.shippingCosts ? pnlComparison.metrics.merchantShippingCosts : null, "Delivery and product shipping costs", true), hint: pnlSummary?.availability.shippingCosts ? "Product overrides and store postage" : "Complete postage costs" },
    { label: "Warehouse fulfilment", value: pnlSummary?.availability.handlingCosts ? formatter.format(pnlSummary.metrics.handlingCosts) : "—", ...moneyDelta(pnlSummary?.availability.handlingCosts ? pnlSummary.metrics.handlingCosts : null, pnlComparison?.availability.handlingCosts ? pnlComparison.metrics.handlingCosts : null, "Fulfilment cost by order or unit", true), hint: pnlSummary?.availability.handlingCosts ? "Store fulfilment default applied" : "Set fulfilment cost" },
    { label: "Contribution margin", value: pnlSummary?.availability.marketingSpend && pnlSummary.availability.shippingCosts && pnlSummary.availability.handlingCosts ? formatter.format(pnlSummary.metrics.contributionMargin) : "—", ...moneyDelta(pnlSummary?.availability.marketingSpend && pnlSummary.availability.shippingCosts && pnlSummary.availability.handlingCosts ? pnlSummary.metrics.contributionMargin : null, pnlComparison?.availability.marketingSpend && pnlComparison.availability.shippingCosts && pnlComparison.availability.handlingCosts ? pnlComparison.metrics.contributionMargin : null, "After variable direct costs"), hint: pnlSummary?.availability.shippingCosts && pnlSummary?.availability.handlingCosts ? "Shipping and handling included" : "Complete shipping and handling costs" },
    { label: "Net profit", value: pnlSummary?.availability.netProfit && pnlSummary.metrics.netProfit !== null ? formatter.format(pnlSummary.metrics.netProfit) : "—", ...moneyDelta(pnlSummary?.availability.netProfit ? pnlSummary.metrics.netProfit : null, pnlComparison?.availability.netProfit ? pnlComparison.metrics.netProfit : null, "After known operating costs"), hint: pnlSummary?.availability.netProfit ? `${pnlSummary.metrics.netMargin === null ? "—" : `${(pnlSummary.metrics.netMargin * 100).toFixed(1)}%`} net margin` : "Complete cost coverage" },
  ] : demoMetrics;
  const trendSeries: FinanceTrendPoint[] = trendData.map(({ period, data }) => {
    const reportRevenue = data.metrics.netProductSales - data.metrics.refunds;
    const reportProfit = data.metrics.netProfit ?? data.metrics.profitAfterMarketingSpend;
    return {
      label: period.label, start: period.start, end: period.end, revenue: reportRevenue, profit: reportProfit, complete: data.availability.netProfit,
      cogs: data.metrics.cogs,
      metaMarketing: data.metrics.metaMarketingSpend,
      googleMarketing: data.metrics.googleMarketingSpend,
      paymentFees: data.metrics.transactionFees,
      shipping: data.metrics.merchantShippingCosts + data.metrics.handlingCosts,
      operating: data.metrics.operatingExpenses,
    };
  });
  useEffect(() => {
    if ((fromDate && !toDate) || (!fromDate && toDate)) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    setShopifyWidgets(null);
    setShopifyWidgetError("");
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
    {loading || trendLoading ? <div className="data-loading">{loading ? "Loading your Shopify summary…" : "Calculating trend periods…"}</div> : !hasLiveData && liveData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to start your live dashboard</strong><span>The figures below are a preview. Your own sales and orders will appear after the first sync.</span></div></div> : null}{liveData?.currencyCoverage.convertedOrders ? <div className="connection-notice"><Info/><div><strong>{liveData.currencyCoverage.convertedOrders.toLocaleString()} orders converted to {liveData.currency}</strong><span>Historical rates applied: {liveData.currencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}.</span></div></div> : null}{liveData?.currencyCoverage.excludedOrders ? <div className="connection-notice"><Info/><div><strong>{liveData.currencyCoverage.excludedOrders.toLocaleString()} orders excluded from financial totals</strong><span>Reporting currency is {liveData.currency}. Excluded: {liveData.currencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}. Add explicit exchange rates before consolidating these orders.</span></div></div> : null}{liveData?.marketingCurrencyCoverage.convertedRows ? <div className="connection-notice"><Info/><div><strong>{liveData.marketingCurrencyCoverage.convertedRows.toLocaleString()} advertising spend rows converted to {liveData.currency}</strong><span>Historical rates applied: {liveData.marketingCurrencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}{liveData?.marketingCurrencyCoverage.excludedRows ? <div className="connection-notice"><Info/><div><strong>{liveData.marketingCurrencyCoverage.excludedRows.toLocaleString()} advertising spend rows excluded</strong><span>Missing dated rates: {liveData.marketingCurrencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}
    <div className="report-export">{hasLiveData ? <button className="export-button" onClick={exportOverview}><Download/> Export overview CSV</button> : null}<button className="export-button" onClick={() => setCustomizingWidgets((current) => !current)}><Settings/> {customizingWidgets ? "Done customizing" : "Customize dashboard"}</button></div>
    {customizingWidgets ? <section className="widget-customizer" aria-label="Dashboard widget settings"><div><strong>Summary widgets</strong><span>Choose what appears and arrange the reading order.</span></div><div className="widget-customizer-list">{widgetPreferences.order.map((id, index) => <div className="widget-customizer-row" key={id}><label><input type="checkbox" checked={widgetVisible(id)} onChange={() => toggleWidget(id)}/><span>{overviewWidgetLabels[id]}</span></label><div><button type="button" disabled={index === 0} onClick={() => moveWidget(id, -1)} aria-label={`Move ${overviewWidgetLabels[id]} earlier`}>↑</button><button type="button" disabled={index === widgetPreferences.order.length - 1} onClick={() => moveWidget(id, 1)} aria-label={`Move ${overviewWidgetLabels[id]} later`}>↓</button></div></div>)}</div><button type="button" className="panel-drilldown" onClick={resetWidgets}>Restore defaults</button></section> : null}
    <section className="metric-grid">{liveMetrics.map((metric) => <button type="button" className="metric-card drilldown-card" key={metric.label} onClick={() => onDrilldown(metricReport(metric.label), drilldownRange)} aria-label={`Open ${metric.label} details`}>
      <div className="metric-head"><span>{metric.label}</span><ExternalLink /></div>
      <strong>{metric.value}</strong>
      <div className="metric-foot"><Trend positive={metric.positive}>{metric.delta}</Trend><span>{metric.hint}</span></div>
    </button>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel finance-chart-panel" style={{ order: 0 }}>
        <div className="panel-head"><div><span className="eyebrow">PERFORMANCE</span><h2>Revenue, costs and profit</h2></div><div className="finance-legend"><span><i className="legend-revenue"/>Revenue</span><span><i className="legend-cogs"/>COGS</span><span><i className="legend-meta"/>Facebook</span><span><i className="legend-google"/>Google</span><span><i className="legend-fees"/>Fees</span><span><i className="legend-shipping"/>Shipping</span><span><i className="legend-operating"/>Operating</span><span><i className="legend-profit"/>Profit</span></div></div>
        <FinanceTrendChart points={trendSeries} formatter={formatter} onOpen={(point) => onDrilldown("Profit & Loss", { from: point.start, to: point.end })}/>
        {trendSeries.some((point) => !point.complete) ? <span className="report-note">Profit is provisional where cost coverage is incomplete. Hover a period for the full revenue and cost bridge.</span> : null}
      </article>
      <article className="panel health-panel" style={{ order: 1 }}><div className="panel-head"><div><span className="eyebrow">DATA HEALTH</span><h2>{hasLiveData ? "Imported store data" : "Store readiness"}</h2></div><span className="score">{hasLiveData ? "LIVE" : "86%"}</span></div>
        <div className="health-ring"><div><strong>{hasLiveData ? liveData!.metrics.orders.toLocaleString() : "86"}</strong><span>{hasLiveData ? "orders" : "Good"}</span></div></div>
        {hasLiveData ? <ul className="health-list"><li><span className="status success"/>Shopify sales loaded <b>{liveData!.metrics.orders.toLocaleString()} orders</b></li><li><span className="status success"/>Data window <b>{liveData!.range.start} – {liveData!.range.end}</b></li><li><span className={(liveData!.meta?.importedDays || liveData!.google?.importedDays) ? "status success" : "status warn"}/>Marketing spend <b>{(liveData!.meta?.importedDays || liveData!.google?.importedDays) ? `${liveData!.meta?.importedDays ?? 0} Meta days · ${liveData!.google?.importedDays ?? 0} Google days` : "No spend loaded"}</b></li></ul> : <ul className="health-list"><li><span className="status success"/>Shopify synced <b>2m ago</b></li><li><span className="status success"/>Ad accounts connected <b>2 of 2</b></li><li><span className="status warn"/>Missing product costs <b>14 SKUs</b></li></ul>}
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

type PnlData = {
  hasData: boolean;
  currency: string;
  timezone: string;
  currencyCoverage: CurrencyCoverage;
  marketingCurrencyCoverage: CurrencyConversionCoverage;
  transactionFeeCoverage?: { salesDays: number; reportedFeeDays: number; latestReportedFeeDate: string | null };
  metrics: { grossSales: number; discounts: number; refunds: number; netProductSales: number; shippingRevenue: number; tax: number; duties: number; totalSales: number; cogs: number; grossProfit: number; grossMargin: number | null; marketingSpend: number; metaMarketingSpend: number; googleMarketingSpend: number; transactionFees: number; merchantShippingCosts: number; variantShippingCosts: number; shippingFallbackCosts: number; handlingCosts: number; fixedOperatingExpenses: number; variableOperatingExpenses: number; operatingExpenses: number; contributionMarginBeforeShipping: number; contributionMarginBeforeShippingPercentage: number | null; contributionMargin: number; contributionMarginPercentage: number | null; profitAfterOperatingCosts: number; profitAfterKnownCosts: number; profitAfterMarketingSpend: number; netProfit: number | null; netMargin: number | null; orders: number; unitsSold: number; missingCostLines: number; missingShippingLines: number; shippingOverrideLines: number; shippingFallbackLines: number; shippingFallbackRate: number | null; unallocatedOperatingCosts: number };
  availability: { marketingSpend: boolean; metaMarketingSpend: boolean; googleMarketingSpend: boolean; transactionFees: boolean; transactionFeesComplete?: boolean; shippingCosts: boolean; handlingCosts: boolean; operatingExpenses: boolean; netProfit: boolean };
  period: { start: string; end: string } | null;
};
type PnlPeriodData = { period: ReportingPeriod; data: PnlData };
type PnlRow = { section: string; label: string; value: (data: PnlData) => string };

type PnlCustomerPeriod = {
  start: string; end: string; label: string;
  newCustomers: number; newOrders: number; newSales: number;
  repeatCustomers: number; repeatOrders: number; repeatSales: number;
  guestOrders: number; guestSales: number; excludedCurrencyOrders: number;
};

function ProfitLoss({ savedPreset, reportRunId, initialRange }: { savedPreset?: "all_imported" | "latest_30_days" | "latest_90_days" | "latest_365_days"; reportRunId?: string; initialRange?: DrilldownContext }) {
  const finishReportRun = useReportRun(reportRunId);
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [comparison, setComparison] = useState<PnlData | null>(null);
  const [yearComparison, setYearComparison] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(initialRange?.from ?? (savedPreset ? "" : default365DayRange.from));
  const [toDate, setToDate] = useState(initialRange?.to ?? (savedPreset ? "" : default365DayRange.to));
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange ? "custom" : savedPreset === "all_imported" ? "all_imported" : savedPreset ? "custom" : "last_365_days");
  const [granularity, setGranularity] = useState<ReportingGranularity>("monthly");
  const [periodData, setPeriodData] = useState<PnlPeriodData[]>([]);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [customerPeriods, setCustomerPeriods] = useState<PnlCustomerPeriod[]>([]);
  const [customerPeriodError, setCustomerPeriodError] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "chart">("table");
  const [showComparison, setShowComparison] = useState(false);
  const [feeRefreshVersion, setFeeRefreshVersion] = useState(0);
  const [feeRefreshBusy, setFeeRefreshBusy] = useState(false);
  const [feeRefreshStatus, setFeeRefreshStatus] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const appliedSavedPreset = useRef<string | null>(null);
  const autoFeeRefreshRanges = useRef(new Set<string>());
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`/api/analytics/pnl${params.size ? `?${params}` : ""}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then(async (payload: PnlData | null) => {
        setPnl(payload); setComparison(null); setYearComparison(null);
        finishReportRun(payload ? "completed" : "failed", payload?.metrics.orders ?? null);
        if (!payload?.period) return;
        const start = new Date(`${payload.period.start}T00:00:00Z`);
        const end = new Date(`${payload.period.end}T00:00:00Z`);
        const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
        const previousEnd = new Date(start); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
        const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
        const date = (value: Date) => value.toISOString().slice(0, 10);
        const previousYearStart = new Date(start); previousYearStart.setUTCFullYear(previousYearStart.getUTCFullYear() - 1);
        const previousYearEnd = new Date(end); previousYearEnd.setUTCFullYear(previousYearEnd.getUTCFullYear() - 1);
        const [previousResponse, previousYearResponse] = await Promise.all([
          fetch(`/api/analytics/pnl?from=${date(previousStart)}&to=${date(previousEnd)}&refresh=0`),
          fetch(`/api/analytics/pnl?from=${date(previousYearStart)}&to=${date(previousYearEnd)}&refresh=0`),
        ]);
        if (previousResponse.ok) setComparison(await previousResponse.json() as PnlData);
        if (previousYearResponse.ok) setYearComparison(await previousYearResponse.json() as PnlData);
      })
      .catch(() => { setPnl(null); setComparison(null); setYearComparison(null); finishReportRun("failed", null, "Profit and loss data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, feeRefreshVersion, finishReportRun]);

  useEffect(() => {
    if (initialRange || !savedPreset || !pnl?.period?.end || appliedSavedPreset.current === savedPreset) return;
    appliedSavedPreset.current = savedPreset;
    const periodEnd = pnl.period.end;
    const timeout = window.setTimeout(() => {
      if (savedPreset === "all_imported") { setDatePreset("all_imported"); setFromDate(""); setToDate(""); return; }
      setDatePreset("custom");
      const days = savedPreset === "latest_30_days" ? 30 : savedPreset === "latest_90_days" ? 90 : 365;
      const end = new Date(`${periodEnd}T00:00:00Z`);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
      setFromDate(start.toISOString().slice(0, 10)); setToDate(periodEnd);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [savedPreset, pnl?.period?.end, initialRange]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!pnl?.period || !pnl.hasData) { setPeriodData([]); return; }
      const periods = reportingPeriods(pnl.period.start, pnl.period.end, granularity, 12);
      setPeriodLoading(true);
      Promise.all(periods.map(async (period) => {
        if (period.start === pnl.period?.start && period.end === pnl.period?.end) return { period, data: pnl };
        const response = await fetch("/api/analytics/pnl?from=" + period.start + "&to=" + period.end + "&refresh=0", { signal: controller.signal });
        return response.ok ? { period, data: await response.json() as PnlData } : null;
      })).then((results) => setPeriodData(results.filter((result): result is PnlPeriodData => result !== null))).catch((error) => { if (error instanceof Error && error.name !== "AbortError") setPeriodData([]); }).finally(() => { if (!controller.signal.aborted) setPeriodLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [granularity, pnl]);

  useEffect(() => {
    if (!pnl?.period || !pnl.hasData) { setCustomerPeriods([]); return; }
    const controller = new AbortController();
    setCustomerPeriodError(false);
    const params = new URLSearchParams({ from: pnl.period.start, to: pnl.period.end, granularity });
    const loadCustomerPeriods = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`/api/analytics/pnl-customer-kpis?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Customer KPI query failed");
          const payload = await response.json() as { periods: PnlCustomerPeriod[] };
          if (!controller.signal.aborted) setCustomerPeriods(payload.periods);
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (attempt === 2) { setCustomerPeriods([]); setCustomerPeriodError(true); return; }
          await new Promise((resolve) => window.setTimeout(resolve, (attempt + 1) * 2000));
        }
      }
    };
    void loadCustomerPeriods();
    return () => controller.abort();
  }, [pnl?.period?.start, pnl?.period?.end, pnl?.hasData, granularity]);

  const hasLiveData = Boolean(pnl?.hasData);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: pnl?.currency || "GBP", maximumFractionDigits: 0 });
  const signed = (amount: number) => amount < 0 ? `-${formatter.format(Math.abs(amount))}` : formatter.format(amount);
  const demoRows = [["Gross sales","£279,402","£264,128","£251,930","£287,690","£416,007","£258,592"],["Discounts","-£18,204","-£16,770","-£15,204","-£17,620","-£24,341","-£14,740"],["Returns","-£7,812","-£9,133","-£8,390","-£9,218","-£12,451","-£7,270"],["Net sales","£253,386","£238,225","£228,336","£260,852","£379,215","£236,582"],["COGS","-£106,680","-£102,498","-£99,852","-£97,781","-£151,909","-£93,095"],["Gross profit","£146,706","£135,727","£128,484","£163,071","£227,306","£143,487"],["Facebook Ads","-£15,421","-£17,890","-£19,806","-£22,514","-£25,932","-£18,142"],["Google Ads","-£8,237","-£9,172","-£10,368","-£12,141","-£13,894","-£9,769"],["Total marketing","-£23,658","-£27,062","-£30,174","-£34,655","-£39,826","-£27,911"],["Transaction & shipping","-£18,405","-£17,909","-£18,175","-£21,104","-£30,676","-£22,659"],["Net profit","£104,643","£90,756","£80,135","£107,312","£156,804","£92,917"]];
  const liveRows = pnl ? [
    ["Gross sales", signed(pnl.metrics.grossSales)],
    ["Discounts", signed(-pnl.metrics.discounts)],
    ["Returns and refunds", signed(-pnl.metrics.refunds)],
    ["Net product sales", signed(pnl.metrics.netProductSales - pnl.metrics.refunds)],
    ["Shipping revenue", signed(pnl.metrics.shippingRevenue)],
    ["Total sales (net product sales + shipping)", signed(pnl.metrics.totalSales)],
    ["Tax collected (excluded from profit)", signed(pnl.metrics.tax)],
    ["Duties collected (excluded from profit)", signed(pnl.metrics.duties)],
    ["Product COGS", signed(-pnl.metrics.cogs)],
    ["Gross profit", signed(pnl.metrics.grossProfit)],
    ["Shopify payment fees", pnl.availability.transactionFees ? signed(-pnl.metrics.transactionFees) : "Not available"],
    ["Fixed operating costs", signed(-pnl.metrics.fixedOperatingExpenses)],
    ["Variable operating costs", signed(-pnl.metrics.variableOperatingExpenses)],
    ["Operating expenses", signed(-pnl.metrics.operatingExpenses)],
    ["Profit after known costs", signed(pnl.metrics.profitAfterKnownCosts)],
    ["Facebook Ads spend", pnl.availability.metaMarketingSpend ? signed(-pnl.metrics.metaMarketingSpend) : "Not imported"],
    ["Google Ads spend", pnl.availability.googleMarketingSpend ? signed(-pnl.metrics.googleMarketingSpend) : "Not imported"],
    ["Total marketing spend", pnl.availability.marketingSpend ? signed(-pnl.metrics.marketingSpend) : "Not imported"],
    ["Contribution margin before shipping", pnl.availability.marketingSpend ? signed(pnl.metrics.contributionMarginBeforeShipping) : "Import ad spend to calculate"],
    ["Profit after marketing spend", pnl.availability.marketingSpend ? signed(pnl.metrics.profitAfterMarketingSpend) : "Import ad spend to calculate"],
    [`Store fulfilment fallback (${pnl.metrics.shippingFallbackLines.toLocaleString()} lines · ${pnl.metrics.shippingFallbackRate === null ? "—" : `${(pnl.metrics.shippingFallbackRate * 100).toFixed(1)}%`})`, signed(-pnl.metrics.shippingFallbackCosts)],
    [`Variant shipping overrides (${pnl.metrics.shippingOverrideLines.toLocaleString()} lines)`, signed(-pnl.metrics.variantShippingCosts)],
    ["Merchant shipping and fulfilment costs", pnl.availability.shippingCosts ? signed(-pnl.metrics.merchantShippingCosts) : `${pnl.metrics.missingShippingLines.toLocaleString()} lines need a shipping cost`],
    ["Handling and pick/pack costs", pnl.availability.handlingCosts ? signed(-pnl.metrics.handlingCosts) : "Add a handling or pick/pack rule"],
    ["Contribution margin", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? signed(pnl.metrics.contributionMargin) : "Add marketing, shipping, and handling costs"],
    ["Net profit", pnl.availability.netProfit && pnl.metrics.netProfit !== null ? signed(pnl.metrics.netProfit) : "Complete cost coverage to calculate"],
  ] : demoRows;
  const sections = ["Sales", "Product costs", "Marketing", "Transaction costs", "Shipping and handling", "Custom expenses", "Contribution and net profit"];
  const pnlRows: PnlRow[] = [
    { section: "Sales", label: "Gross sales", value: (data) => signed(data.metrics.grossSales) },
    { section: "Sales", label: "Discounts", value: (data) => signed(-data.metrics.discounts) },
    { section: "Sales", label: "Returns and refunds", value: (data) => signed(-data.metrics.refunds) },
    { section: "Sales", label: "Net product sales", value: (data) => signed(data.metrics.netProductSales - data.metrics.refunds) },
    { section: "Sales", label: "Shipping revenue", value: (data) => signed(data.metrics.shippingRevenue) },
    { section: "Sales", label: "Total sales", value: (data) => signed(data.metrics.totalSales) },
    { section: "Sales", label: "Tax collected (excluded)", value: (data) => signed(data.metrics.tax) },
    { section: "Sales", label: "Duties collected (excluded)", value: (data) => signed(data.metrics.duties) },
    { section: "Product costs", label: "Product COGS", value: (data) => signed(-data.metrics.cogs) },
    { section: "Product costs", label: "Gross profit", value: (data) => signed(data.metrics.grossProfit) },
    { section: "Marketing", label: "Facebook Ads spend", value: (data) => data.availability.metaMarketingSpend ? signed(-data.metrics.metaMarketingSpend) : "Not imported" },
    { section: "Marketing", label: "Google Ads spend", value: (data) => data.availability.googleMarketingSpend ? signed(-data.metrics.googleMarketingSpend) : "Not imported" },
    { section: "Marketing", label: "Total marketing spend", value: (data) => data.availability.marketingSpend ? signed(-data.metrics.marketingSpend) : "Not imported" },
    { section: "Transaction costs", label: "Shopify payment fees", value: (data) => data.availability.transactionFees ? signed(-data.metrics.transactionFees) : "Not available" },
    { section: "Shipping and handling", label: "Store fulfilment fallback", value: (data) => signed(-data.metrics.shippingFallbackCosts) },
    { section: "Shipping and handling", label: "Variant shipping overrides", value: (data) => signed(-data.metrics.variantShippingCosts) },
    { section: "Shipping and handling", label: "Merchant shipping and fulfilment", value: (data) => data.availability.shippingCosts ? signed(-data.metrics.merchantShippingCosts) : "Coverage needed" },
    { section: "Shipping and handling", label: "Handling and pick/pack", value: (data) => data.availability.handlingCosts ? signed(-data.metrics.handlingCosts) : "Coverage needed" },
    { section: "Custom expenses", label: "Fixed operating costs", value: (data) => signed(-data.metrics.fixedOperatingExpenses) },
    { section: "Custom expenses", label: "Variable operating costs", value: (data) => signed(-data.metrics.variableOperatingExpenses) },
    { section: "Custom expenses", label: "Operating expenses", value: (data) => signed(-data.metrics.operatingExpenses) },
    { section: "Contribution and net profit", label: "Profit after known costs", value: (data) => signed(data.metrics.profitAfterKnownCosts) },
    { section: "Contribution and net profit", label: "Contribution margin before shipping", value: (data) => data.availability.marketingSpend ? signed(data.metrics.contributionMarginBeforeShipping) : "Marketing needed" },
    { section: "Contribution and net profit", label: "Contribution margin", value: (data) => data.availability.marketingSpend && data.availability.shippingCosts && data.availability.handlingCosts ? signed(data.metrics.contributionMargin) : "Coverage needed" },
    { section: "Contribution and net profit", label: "Net profit", value: (data) => data.availability.netProfit && data.metrics.netProfit !== null ? signed(data.metrics.netProfit) : "Coverage needed" },
  ];
  const displayPeriods: PnlPeriodData[] = periodData.length ? periodData : pnl?.period ? [{ period: { ...pnl.period, label: pnl.period.start + " to " + pnl.period.end }, data: pnl }] : [];
  const displayedColumns = showComparison && comparison?.hasData ? [...displayPeriods, { period: { start: comparison.period?.start ?? "", end: comparison.period?.end ?? "", label: "Previous period" }, data: comparison }] : displayPeriods;
  const chartMaximum = Math.max(...displayPeriods.flatMap(({ data }) => [Math.abs(data.metrics.netProductSales - data.metrics.refunds), Math.abs(data.metrics.grossProfit), Math.abs(data.metrics.netProfit ?? 0)]), 1);
  const summary = pnl ? [
    ["NET PRODUCT SALES", formatter.format(pnl.metrics.netProductSales - pnl.metrics.refunds), `${pnl.metrics.orders.toLocaleString()} orders`],
    ["GROSS PROFIT", formatter.format(pnl.metrics.grossProfit), pnl.metrics.grossMargin === null ? "Cost coverage needed" : `${(pnl.metrics.grossMargin * 100).toFixed(1)}% margin`],
    ["OPERATING EXPENSES", formatter.format(pnl.metrics.operatingExpenses), pnl.metrics.unallocatedOperatingCosts ? `${pnl.metrics.unallocatedOperatingCosts} costs need attention` : `${formatter.format(pnl.metrics.fixedOperatingExpenses)} fixed · ${formatter.format(pnl.metrics.variableOperatingExpenses)} variable`],
    ["MISSING COST LINES", pnl.metrics.missingCostLines.toLocaleString(), pnl.metrics.missingCostLines ? "Add costs to improve profit" : "All order lines costed"],
    ["PROFIT AFTER MARKETING", pnl.availability.marketingSpend ? formatter.format(pnl.metrics.profitAfterMarketingSpend) : "—", pnl.availability.marketingSpend ? "Meta + Google Ads spend included" : "Import ad spend"],
    ["CONTRIBUTION MARGIN", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? formatter.format(pnl.metrics.contributionMargin) : pnl.availability.marketingSpend ? formatter.format(pnl.metrics.contributionMarginBeforeShipping) : "—", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? `${pnl.metrics.contributionMarginPercentage === null ? "—" : `${(pnl.metrics.contributionMarginPercentage * 100).toFixed(1)}%`} after shipping and handling` : pnl.availability.marketingSpend ? `${pnl.metrics.contributionMarginBeforeShippingPercentage === null ? "—" : `${(pnl.metrics.contributionMarginBeforeShippingPercentage * 100).toFixed(1)}%`} before shipping and handling` : "Import ad spend"],
  ] : [["NET SALES", "£236,582", "+11.2%"], ["GROSS PROFIT", "£143,487", "+9.4%"], ["MARKETING", "£27,911", "+4.1%"], ["NET PROFIT", "£92,917", "+18.2%"]];
  const totalRows = hasLiveData ? new Set([3, 5, 9, 13, 14, 17, 18, 19, 22, 24, 25]) : new Set([3, 5, 8, 10]);
  const reconciliationIssues = pnl ? [
    pnl.metrics.missingCostLines > 0 ? `${pnl.metrics.missingCostLines.toLocaleString()} product lines need costs` : null,
    pnl.metrics.missingShippingLines > 0 ? `${pnl.metrics.missingShippingLines.toLocaleString()} product lines need shipping costs` : null,
    !pnl.availability.handlingCosts ? "handling or pick/pack costs are missing" : null,
    !pnl.availability.marketingSpend ? "marketing spend is not imported" : null,
    !pnl.availability.transactionFeesComplete ? `Shopify payment fees cover ${pnl.transactionFeeCoverage?.reportedFeeDays ?? 0} of ${pnl.transactionFeeCoverage?.salesDays ?? 0} sales days` : null,
    pnl.metrics.unallocatedOperatingCosts > 0 ? `${pnl.metrics.unallocatedOperatingCosts.toLocaleString()} operating costs need attention` : null,
  ].filter((issue): issue is string => Boolean(issue)) : [];
  if (pnl) summary.unshift(["RECONCILIATION", reconciliationIssues.length ? "Provisional" : "Complete", reconciliationIssues.length ? reconciliationIssues.join(" · ") : "All required cost inputs are covered for this period"]);
  const change = (current: number, previous: number) => previous ? ((current - previous) / Math.abs(previous)) * 100 : null;

  const exportPnl = () => {
    if (!pnl) return;
    const visibleRows = sections.flatMap((section) => collapsedSections.has(section) ? [] : [
      [section, ...displayedColumns.map(() => "")],
      ...pnlRows.filter((row) => row.section === section).map((row) => [row.label, ...displayedColumns.map((column) => row.value(column.data))]),
    ]);
    downloadCsv("profit-and-loss.csv", [
      ["Report", "Profit & Loss"],
      ["Period", pnl.period ? pnl.period.start + " to " + pnl.period.end : "No imported orders"],
      ["Granularity", granularity],
      ["Comparison overlay", showComparison ? "Previous period" : "Off"],
      ["Currency", pnl.currency],
      ["Timezone", pnl.timezone],
      ["Generated at", new Date().toISOString()],
      [],
      ["Metric", ...displayedColumns.map((column) => column.period.label)],
      ...visibleRows,
    ]);
  };

  const customerPeriodByRange = new Map(customerPeriods.map((period) => [`${period.start}:${period.end}`, period]));
  const pct = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
  const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
  const multiple = (numerator: number, denominator: number) => denominator > 0 ? `${(numerator / denominator).toFixed(2)}x` : "—";
  const kpiMoney = (numerator: number, denominator: number) => denominator > 0 ? formatter.format(numerator / denominator) : "—";
  const customerValue = (customer: PnlCustomerPeriod | null, key: keyof PnlCustomerPeriod) => customer ? Number(customer[key]).toLocaleString("en-GB") : "—";
  const pnlKpiGroups: Array<{ heading: string; rows: Array<{ label: string; value: (data: PnlData, customer: PnlCustomerPeriod | null) => string }> }> = [
    { heading: "KPIs", rows: [
      { label: "Gross margin", value: (data) => pct(data.metrics.grossMargin) },
      { label: "Net margin", value: (data) => pct(data.metrics.netMargin) },
      { label: "Refunds / gross sales", value: (data) => pct(ratio(data.metrics.refunds, data.metrics.grossSales)) },
      { label: "COGS / net product sales", value: (data) => pct(ratio(data.metrics.cogs, data.metrics.netProductSales - data.metrics.refunds)) },
      { label: "Marketing / net product sales", value: (data) => data.availability.marketingSpend ? pct(ratio(data.metrics.marketingSpend, data.metrics.netProductSales - data.metrics.refunds)) : "—" },
    ] },
    { heading: "Acquisition and retention", rows: [
      { label: "Blended CAC", value: (data, customer) => data.availability.marketingSpend && customer ? kpiMoney(data.metrics.marketingSpend, customer.newCustomers) : "—" },
      { label: "Blended ROAS", value: (data) => data.availability.marketingSpend ? multiple(data.metrics.totalSales, data.metrics.marketingSpend) : "—" },
      { label: "New customer ROAS", value: (data, customer) => data.availability.marketingSpend && customer ? multiple(customer.newSales, data.metrics.marketingSpend) : "—" },
      { label: "New customers", value: (_, customer) => customerValue(customer, "newCustomers") },
      { label: "New customer sales", value: (_, customer) => customer ? formatter.format(customer.newSales) : "—" },
      { label: "Profit per new customer", value: (data, customer) => data.availability.netProfit && data.metrics.netProfit !== null && customer ? kpiMoney(data.metrics.netProfit, customer.newCustomers) : "—" },
      { label: "Repeat customers", value: (_, customer) => customerValue(customer, "repeatCustomers") },
      { label: "Repeat customer sales", value: (_, customer) => customer ? formatter.format(customer.repeatSales) : "—" },
      { label: "Repeat orders", value: (_, customer) => customer ? pct(ratio(customer.repeatOrders, customer.newOrders + customer.repeatOrders)) : "—" },
      { label: "Repeat sales", value: (_, customer) => customer ? pct(ratio(customer.repeatSales, customer.newSales + customer.repeatSales)) : "—" },
    ] },
    { heading: "Orders", rows: [
      { label: "Orders", value: (data) => data.metrics.orders.toLocaleString("en-GB") },
      { label: "Average order value", value: (data) => kpiMoney(data.metrics.totalSales, data.metrics.orders) },
      { label: "New customer AOV", value: (_, customer) => customer ? kpiMoney(customer.newSales, customer.newOrders) : "—" },
      { label: "Repeat customer AOV", value: (_, customer) => customer ? kpiMoney(customer.repeatSales, customer.repeatOrders) : "—" },
      { label: "Average items per order", value: (data) => data.metrics.orders > 0 ? (data.metrics.unitsSold / data.metrics.orders).toFixed(1) : "—" },
    ] },
  ];

  const refreshShopifyFees = async () => {
    const range = pnl?.period;
    if (!range) return;
    const latestStart = financeDateRange("last_365_days").from;
    const from = Date.parse(range.end) - Date.parse(range.start) <= 366 * 86400000 ? range.start : latestStart;
    setFeeRefreshBusy(true); setFeeRefreshStatus("");
    try {
      const response = await fetch("/api/connections/shopify/fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to: range.end }) });
      const result = await response.json() as { importedDays?: number; warning?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Shopify fees could not be refreshed");
      setFeeRefreshStatus(result.warning || `Refreshed payment fees for ${result.importedDays ?? 0} days.`);
      setFeeRefreshVersion((value) => value + 1);
    } catch (error) { setFeeRefreshStatus(error instanceof Error ? error.message : "Shopify fees could not be refreshed"); }
    finally { setFeeRefreshBusy(false); }
  };

  useEffect(() => {
    if (!pnl?.hasData || !pnl.period || pnl.availability.transactionFeesComplete) return;
    const key = `${pnl.period.start}:${pnl.period.end}`;
    if (autoFeeRefreshRanges.current.has(key)) return;
    autoFeeRefreshRanges.current.add(key);
    void refreshShopifyFees();
  }, [pnl?.period?.start, pnl?.period?.end, pnl?.hasData, pnl?.availability.transactionFeesComplete]);

  const applyPnlDatePreset = (preset: FinanceDatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = financeDateRange(preset);
    setLoading(true); setFromDate(range.from); setToDate(range.to);
  };

  const toggleSection = (section: string) => setCollapsedSections((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });

  if (pnl && (viewMode === "table" || viewMode === "chart")) return <>
    <section className="filter-row pnl-period finance-date-controls">
      <label>Period<select aria-label="P&L date period" value={datePreset} onChange={(event) => applyPnlDatePreset(event.target.value as FinanceDatePreset)}><option value="last_7_days">Last 7 days (today)</option><option value="last_7_complete_days">Last 7 complete days</option><option value="last_30_days">Last 30 days (today)</option><option value="last_30_complete_days">Last 30 complete days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option></select></label>
      <label>From<input type="date" value={fromDate} onChange={(event) => { setDatePreset("custom"); setFromDate(event.target.value); }} /></label>
      <label>To<input type="date" value={toDate} onChange={(event) => { setDatePreset("custom"); setToDate(event.target.value); }} /></label>
      <label>Group by<select aria-label="P&L granularity" value={granularity} onChange={(event) => setGranularity(event.target.value as ReportingGranularity)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
      <div className="segmented"><button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>Table</button><button className={viewMode === "chart" ? "active" : ""} onClick={() => setViewMode("chart")}>Chart</button></div>
      <label className="comparison-toggle"><input type="checkbox" checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)}/> Previous period</label>
    </section>
    {loading || periodLoading ? <div className="data-loading">Calculating reconciled periods…</div> : null}
    {!pnl.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to build your income statement</strong><span>Your period views will populate after the first sync.</span></div></div> : null}{pnl.currencyCoverage.convertedOrders ? <div className="connection-notice"><Info/><div><strong>{pnl.currencyCoverage.convertedOrders.toLocaleString()} orders converted in this P&amp;L</strong><span>Historical rates applied into {pnl.currency}: {pnl.currencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}.</span></div></div> : null}{pnl.currencyCoverage.excludedOrders ? <div className="connection-notice"><Info/><div><strong>{pnl.currencyCoverage.excludedOrders.toLocaleString()} orders excluded from this P&amp;L</strong><span>Reporting currency is {pnl.currency}. Excluded: {pnl.currencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}. Spine never combines currencies without an explicit dated exchange rate.</span></div></div> : null}{pnl.marketingCurrencyCoverage.convertedRows ? <div className="connection-notice"><Info/><div><strong>{pnl.marketingCurrencyCoverage.convertedRows.toLocaleString()} advertising spend rows converted</strong><span>Historical rates applied into {pnl.currency}: {pnl.marketingCurrencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}{pnl.marketingCurrencyCoverage.excludedRows ? <div className="connection-notice"><Info/><div><strong>{pnl.marketingCurrencyCoverage.excludedRows.toLocaleString()} advertising spend rows excluded</strong><span>Net profit stays provisional until dated rates exist for {pnl.marketingCurrencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}
    {pnl.hasData && !pnl.availability.transactionFeesComplete ? <div className="connection-notice"><Info/><div><strong>Shopify payment fees need attention</strong><span>{pnl.transactionFeeCoverage?.reportedFeeDays ?? 0} of {pnl.transactionFeeCoverage?.salesDays ?? 0} sales days have imported fees. {pnl.transactionFeeCoverage?.latestReportedFeeDate ? `Latest fee date: ${pnl.transactionFeeCoverage.latestReportedFeeDate}.` : "No fees were returned for this period."} Net profit remains provisional until fees are covered.</span><button type="button" className="secondary-button" disabled={feeRefreshBusy} onClick={() => void refreshShopifyFees()}>{feeRefreshBusy ? "Refreshing Shopify fees…" : "Refresh Shopify fees"}</button>{feeRefreshStatus ? <small>{feeRefreshStatus}</small> : null}</div></div> : null}
    {pnl.hasData ? <div className="connection-notice"><Info/><div><strong>{reconciliationIssues.length ? "Reconciliation status: provisional" : "Reconciliation status: complete"}</strong><span>{reconciliationIssues.length ? reconciliationIssues.join(" · ") : "All required cost inputs are covered for this period."}</span></div></div> : null}
    {pnl.hasData ? <><div className="report-export"><button className="export-button" onClick={exportPnl}><Download/> Export visible P&amp;L CSV</button></div><details className="metric-dictionary"><summary>Metric definitions</summary><dl><div><dt>Total sales</dt><dd>Net product sales plus customer shipping revenue. Tax and duties are shown separately.</dd></div><div><dt>Gross profit</dt><dd>Net product sales after refunds, less effective-dated product costs.</dd></div><div><dt>Net profit</dt><dd>Available after marketing, shipping, handling, product-cost, and operating-cost coverage is complete.</dd></div></dl></details></> : null}
    <section className="panel report-panel"><div className="report-summary">{summary.map(([label, value, hint]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
      {viewMode === "chart" && displayPeriods.length ? <div className="pnl-chart"><div className="panel-head"><div><span className="eyebrow">PROFIT TREND</span><h2>Revenue, gross profit, and net profit</h2></div><div className="legend"><span className="blue-dot"/>Net sales <span className="green-dot"/>Gross profit <span className="orange-dot"/>Net profit</div></div><div className="chart-wrap"><div className="y-axis"><span>{formatter.format(chartMaximum)}</span><span>{formatter.format(chartMaximum / 2)}</span><span>{formatter.format(chartMaximum / 4)}</span><span>{formatter.format(0)}</span></div><div className="bar-chart">{displayPeriods.map(({ period, data }) => <div className="bar-group" key={period.start + "-" + period.end}><div className="bars"><i className="revenue" style={{height:(Math.abs(data.metrics.netProductSales - data.metrics.refunds) / chartMaximum * 100) + "%"}}/><i className="profit" style={{height:(Math.abs(data.metrics.grossProfit) / chartMaximum * 100) + "%"}}/><i className="spend" style={{height:(Math.abs(data.metrics.netProfit ?? 0) / chartMaximum * 100) + "%"}}/></div><span>{period.label}</span></div>)}</div></div></div> : null}
      {viewMode === "table" ? <div className="table-scroll"><table className="data-table pnl-table period-table"><thead><tr><th>Income statement</th>{displayedColumns.map((column, index) => <th key={column.period.start + "-" + column.period.end + "-" + index}>{column.period.label}</th>)}</tr></thead><tbody>{sections.map((section) => [<tr className="pnl-section" key={section + "-heading"}><td colSpan={displayedColumns.length + 1}><button onClick={() => toggleSection(section)}><ChevronDown className={collapsedSections.has(section) ? "collapsed" : ""}/>{section}</button></td></tr>, ...(collapsedSections.has(section) ? [] : pnlRows.filter((row) => row.section === section).map((row) => <tr className={row.label.includes("profit") || row.label.includes("margin") || row.label === "Total sales" || row.label === "Total marketing spend" ? "total" : ""} key={section + "-" + row.label}><td><span className="indent">{row.label}</span></td>{displayedColumns.map((column, index) => <td key={row.label + "-" + index}>{row.value(column.data)}</td>)}</tr>))])}</tbody></table></div> : null}
      <div className="table-footer"><span>{periodData.length >= 12 ? "Showing the latest 12 " + granularity + " periods" : displayPeriods.length + " " + granularity + " period" + (displayPeriods.length === 1 ? "" : "s")}</span><span>{showComparison ? "Previous-period overlay on" : "Comparison overlay off"}</span></div>
    </section>
    {pnl.hasData ? <section className="panel report-panel pnl-kpi-panel">
      <div className="panel-head"><div><span className="eyebrow">OPERATING METRICS</span><h2>Margins, acquisition and orders</h2><p>Calculated for the same periods as the income statement.</p></div></div>
      {customerPeriodError ? <div className="connection-notice"><Info/><div><strong>Customer metrics could not be loaded</strong><span>Margin and order metrics remain available. Refresh to retry customer metrics.</span></div></div> : null}
      <div className="table-scroll"><table className="data-table pnl-table period-table pnl-kpi-table"><thead><tr><th>Metric</th>{displayedColumns.map((column, index) => <th key={column.period.start + "-" + column.period.end + "-kpi-" + index}>{column.period.label}</th>)}</tr></thead><tbody>{pnlKpiGroups.map((group) => [<tr className="pnl-section" key={group.heading + "-heading"}><td colSpan={displayedColumns.length + 1}>{group.heading}</td></tr>, ...group.rows.map((row) => <tr key={group.heading + "-" + row.label}><td><span className="indent">{row.label}</span></td>{displayedColumns.map((column, index) => <td key={row.label + "-" + index}>{row.value(column.data, customerPeriodByRange.get(`${column.period.start}:${column.period.end}`) ?? null)}</td>)}</tr>)] )}</tbody></table></div>
      <div className="table-footer"><span>New = first valid imported order for an identified customer; repeat = later orders. Guest orders are excluded from the new/repeat split.</span><span>— means no denominator or incomplete source coverage.</span></div>
    </section> : null}
  </>;

  return <>{comparison?.hasData && pnl?.hasData ? <section className="cost-grid live pnl-comparison"><div><strong>{change(pnl.metrics.netProductSales, comparison.metrics.netProductSales) === null ? "—" : `${change(pnl.metrics.netProductSales, comparison.metrics.netProductSales)!.toFixed(1)}%`}</strong><span>Net product sales vs previous period</span></div><div><strong>{change(pnl.metrics.grossProfit, comparison.metrics.grossProfit) === null ? "—" : `${change(pnl.metrics.grossProfit, comparison.metrics.grossProfit)!.toFixed(1)}%`}</strong><span>Gross profit vs previous period</span></div><div><strong>{pnl.metrics.orders - comparison.metrics.orders >= 0 ? "+" : ""}{(pnl.metrics.orders - comparison.metrics.orders).toLocaleString()}</strong><span>Orders vs previous period</span></div></section> : null}{yearComparison?.hasData && pnl?.hasData ? <section className="cost-grid live pnl-comparison"><div><strong>{change(pnl.metrics.netProductSales, yearComparison.metrics.netProductSales) === null ? "—" : `${change(pnl.metrics.netProductSales, yearComparison.metrics.netProductSales)!.toFixed(1)}%`}</strong><span>Net product sales vs previous year</span></div><div><strong>{change(pnl.metrics.grossProfit, yearComparison.metrics.grossProfit) === null ? "—" : `${change(pnl.metrics.grossProfit, yearComparison.metrics.grossProfit)!.toFixed(1)}%`}</strong><span>Gross profit vs previous year</span></div><div><strong>{pnl.metrics.orders - yearComparison.metrics.orders >= 0 ? "+" : ""}{(pnl.metrics.orders - yearComparison.metrics.orders).toLocaleString()}</strong><span>Orders vs previous year</span></div></section> : null}<section className="filter-row pnl-period finance-date-controls"><label>Period<select aria-label="P&L date period" value={datePreset} onChange={(event) => applyPnlDatePreset(event.target.value as FinanceDatePreset)}><option value="last_7_days">Last 7 days (today)</option><option value="last_7_complete_days">Last 7 complete days</option><option value="last_30_days">Last 30 days (today)</option><option value="last_30_complete_days">Last 30 complete days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option></select></label><label>From<input type="date" value={fromDate} onChange={(event) => { setDatePreset("custom"); setFromDate(event.target.value); }} /></label><label>To<input type="date" value={toDate} onChange={(event) => { setDatePreset("custom"); setToDate(event.target.value); }} /></label></section>{loading ? <div className="data-loading">Calculating your income statement…</div> : !hasLiveData && pnl ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to build your income statement</strong><span>The preview will be replaced with reconciled sales and cost data after your first sync.</span></div></div> : null}{hasLiveData ? <div className="connection-notice"><Info/><div><strong>How this P&amp;L is calculated</strong><span>Total sales are net product sales plus shipping revenue. Gross profit is Shopify net product sales, less refunds and effective-dated product costs. Tax and duties are shown for reconciliation but excluded from profit. Operating expenses include your fixed, per-order, per-unit, and revenue-rate rules. Actual Shopify payment fees take priority; matching gateway rules estimate missing fees. Imported Meta and Google Ads spend is deducted when it overlaps the selected period. Fulfilment, handling, and pick/pack rules provide the remaining direct costs.</span></div></div> : null}{hasLiveData && pnl!.metrics.missingCostLines > 0 ? <div className="connection-notice"><Info/><div><strong>{pnl!.metrics.missingCostLines} order lines are missing a product cost</strong><span>Gross profit is provisional until you add an effective-dated product cost for these variants.</span></div></div> : null}{hasLiveData && pnl!.metrics.unallocatedOperatingCosts > 0 ? <div className="connection-notice"><Info/><div><strong>{pnl!.metrics.unallocatedOperatingCosts} operating costs still need an allocation rule</strong><span>The P&amp;L excludes these costs because their currency or effective dates need attention.</span></div></div> : null}{hasLiveData ? <><div className="report-export"><button className="export-button" onClick={exportPnl}><Download/> Export P&amp;L CSV</button></div><details className="metric-dictionary"><summary>Metric definitions</summary><dl><div><dt>Total sales</dt><dd>Net product sales plus customer shipping revenue. Tax and duties are shown separately.</dd></div><div><dt>Gross profit</dt><dd>Net product sales after refunds, less effective-dated product costs. It is marked provisional when a line has no cost.</dd></div><div><dt>Profit after known costs</dt><dd>Gross profit less payment fees, merchant shipping, handling, pick/pack, fixed operating costs, and variable operating costs available to Spine.</dd></div><div><dt>Profit after marketing spend</dt><dd>Profit after known costs less imported Meta and Google Ads spend in the selected period.</dd></div><div><dt>Net profit</dt><dd>Available only after marketing, merchant shipping, handling, product costs, and operating-cost coverage are complete.</dd></div></dl></details></> : null}<section className="panel report-panel"><div className="report-summary">{summary.map(([label, value, hint])=><div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div><div className="table-scroll"><table className="data-table pnl-table"><thead><tr><th>Income statement</th><th>{hasLiveData ? pnl?.period ? `${pnl.period.start} to ${pnl.period.end}` : "Selected period" : "Apr 2026"}</th>{!hasLiveData&&months.slice(1).map(month=><th key={month}>{month} 2026</th>)}</tr></thead><tbody>{liveRows.map((row,index)=><tr className={totalRows.has(index)?"total":""} key={row[0]}>{row.map((cell,i)=><td key={`${cell}-${i}`}>{i===0 && !totalRows.has(index)?<span className="indent">{cell}</span>:cell}</td>)}</tr>)}</tbody></table></div></section></>;
}

type CustomSpendBatch = { id: string; original_filename: string; row_count: number; inserted_count: number; updated_count: number; rolled_back_at: string | null; created_at: string };
type CampaignMappingRow = { id: string; platform: "meta"; external_campaign_id: string; external_campaign_name: string; utm_source: string; utm_medium: string; utm_campaign: string; updated_at: string };
type CampaignMappingData = { canManage: boolean; mappings: CampaignMappingRow[]; campaigns: Array<{ campaign_id: string; campaign_name: string; account_id: string; account_name: string | null; currency: string }> };
type UtmRow = { channel: string; source: string; medium: string; campaign: string; content: string; term: string; landingPage: string; customerType: string; sales: number; refunds: number; cogs: number; missingCostUnits: number; marketingCost: number | null; orders: number; customers: number; newCustomerSales: number; averageOrderValue: number; revenuePerCustomer: number | null };
type UtmData = { hasData: boolean; currency: string; timezone: string; attributionModel: "first_touch" | "last_touch"; filterOptions: { countries: string[]; products: string[] }; mappingCoverage: { importedCampaigns: number; mappedCampaigns: number; customSpendRows: number; customSpend: number; mappedSpend: number; allocatedSpend: number; unmappedSpend: number; unallocatedSpend: number; currencyCoverage: CurrencyConversionCoverage }; period: { start: string; end: string } | null; totals: { sales: number; refunds: number; cogs: number; missingCostUnits: number; orders: number; attributedOrders: number; customers: number; newCustomerSales: number; averageOrderValue: number; revenuePerCustomer: number | null }; diagnostics: { missingAttribution: { orders: number; sales: number }; missingUtm: { orders: number; sales: number }; missingLandingPage: { orders: number; sales: number }; missingReferrer: { orders: number; sales: number } }; trends: Array<{ period: string; sales: number; orders: number; customers: number; newCustomerSales: number }>; rows: UtmRow[] };

function UTMAnalysis({ reportRunId, initialRange }: { reportRunId?: string; initialRange?: DrilldownContext }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<UtmData | null>(null);
  const [profitData, setProfitData] = useState<PnlData | null>(null);
  const [comparisonData, setComparisonData] = useState<UtmData | null>(null);
  const [profitTrends, setProfitTrends] = useState<{ current: Array<{ label: string; value: number }>; previous: Array<{ label: string; value: number }> }>({ current: [], previous: [] });
  const [trendMetric, setTrendMetric] = useState<"sales" | "orders" | "customers" | "profit">("sales");
  const [trendLoading, setTrendLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState(initialRange?.source || "all");
  const [medium, setMedium] = useState(initialRange?.medium || "all");
  const [campaign, setCampaign] = useState(initialRange?.campaign || "all");
  const [landingPage, setLandingPage] = useState(initialRange?.landingPage || "all");
  const [customerType, setCustomerType] = useState(initialRange?.customerType || "all");
  const [country, setCountry] = useState(initialRange?.country || "all");
  const [product, setProduct] = useState(initialRange?.product || "all");
  const [comparisonMode, setComparisonMode] = useState<"previous_period" | "previous_year">(initialRange?.comparisonMode || "previous_period");
  const [attributionModel, setAttributionModel] = useState<"first_touch" | "last_touch">(initialRange?.attributionModel || "last_touch");
  const [fromDate, setFromDate] = useState(initialRange?.from || "");
  const [toDate, setToDate] = useState(initialRange?.to || "");
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange ? "custom" : "all_imported");
  const [groupBy, setGroupBy] = useState<ReportingGranularity>("monthly");
  const [mappingData, setMappingData] = useState<CampaignMappingData | null>(null);
  const [mappingForm, setMappingForm] = useState({ externalCampaignId: "", target: "" });
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState("");
  const [mappingRevision, setMappingRevision] = useState(0);
  const [customSpendImporting, setCustomSpendImporting] = useState(false);
  const [customSpendStatus, setCustomSpendStatus] = useState("");
  const [customSpendDraft, setCustomSpendDraft] = useState<ParsedCustomSpendCsv | null>(null);
  const [customSpendPreview, setCustomSpendPreview] = useState<{ filename: string; rows: CustomSpendInputRow[] } | null>(null);
  const [customSpendBatches, setCustomSpendBatches] = useState<CustomSpendBatch[]>([]);
  const [campaignBuilder, setCampaignBuilder] = useState({ baseUrl: "", source: "", medium: "", campaign: "", content: "", term: "" });
  const [campaignUrlStatus, setCampaignUrlStatus] = useState("");
  const [saveViewStatus, setSaveViewStatus] = useState("");
  const loadMappings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/campaign-mappings");
      const payload = await response.json() as CampaignMappingData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load campaign mappings");
      setMappingData(payload); setMappingError("");
    } catch (reason) { setMappingData(null); setMappingError(reason instanceof Error ? reason.message : "Could not load campaign mappings"); }
  }, []);
  useEffect(() => { const timeout = window.setTimeout(() => void loadMappings(), 0); return () => window.clearTimeout(timeout); }, [loadMappings]);
  const loadCustomSpend = useCallback(async () => { try { const response = await fetch("/api/settings/custom-spend"); if (!response.ok) return; const payload = await response.json() as { batches?: CustomSpendBatch[] }; setCustomSpendBatches(payload.batches ?? []); } catch { setCustomSpendBatches([]); } }, []);
  useEffect(() => { const timeout = window.setTimeout(() => void loadCustomSpend(), 0); return () => window.clearTimeout(timeout); }, [loadCustomSpend]);
  useEffect(() => {
    const params = new URLSearchParams({ attribution: attributionModel, groupBy });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (country !== "all") params.set("country", country);
    if (product !== "all") params.set("product", product);
    const pnlParams = new URLSearchParams();
    if (fromDate) pnlParams.set("from", fromDate);
    if (toDate) pnlParams.set("to", toDate);
    Promise.all([
      fetch(`/api/analytics/utm?${params}`).then(async (response) => response.ok ? response.json() as Promise<UtmData> : null),
      fetch(`/api/analytics/pnl${pnlParams.size ? `?${pnlParams}` : ""}`).then(async (response) => response.ok ? response.json() as Promise<PnlData> : null),
    ]).then(([payload, profit]) => { setData(payload); setProfitData(profit); finishReportRun(payload ? "completed" : "failed", payload?.rows.length ?? null); }).catch(() => { setData(null); setProfitData(null); finishReportRun("failed", null, "UTM data could not be loaded"); }).finally(() => setLoading(false));
  }, [attributionModel, fromDate, toDate, country, product, groupBy, mappingRevision, finishReportRun]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!data?.period) { setComparisonData(null); setProfitTrends({ current: [], previous: [] }); return; }
      const start = new Date(`${data.period.start}T00:00:00Z`);
      const end = new Date(`${data.period.end}T00:00:00Z`);
      const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      const previousStart = new Date(start);
      const previousEnd = new Date(end);
      if (comparisonMode === "previous_year") { previousStart.setUTCFullYear(previousStart.getUTCFullYear() - 1); previousEnd.setUTCFullYear(previousEnd.getUTCFullYear() - 1); }
      else { previousEnd.setUTCDate(previousEnd.getUTCDate() - days); previousStart.setTime(previousEnd.getTime()); previousStart.setUTCDate(previousStart.getUTCDate() - days + 1); }
      const previousFrom = previousStart.toISOString().slice(0, 10);
      const previousTo = previousEnd.toISOString().slice(0, 10);
      const currentPeriods = reportingPeriods(data.period.start, data.period.end, groupBy, 12);
      const previousPeriods = reportingPeriods(previousFrom, previousTo, groupBy, 12);
      const comparisonParams = new URLSearchParams({ attribution: attributionModel, from: previousFrom, to: previousTo, groupBy });
      if (country !== "all") comparisonParams.set("country", country);
      if (product !== "all") comparisonParams.set("product", product);
      setTrendLoading(true);
      Promise.all([
        fetch(`/api/analytics/utm?${comparisonParams}`, { signal: controller.signal }).then(async (response) => response.ok ? response.json() as Promise<UtmData> : null),
        Promise.all(currentPeriods.map(async (period) => {
          const response = await fetch(`/api/analytics/pnl?from=${period.start}&to=${period.end}`, { signal: controller.signal });
          if (!response.ok) return { label: period.label, value: 0 };
          const payload = await response.json() as PnlData;
          return { label: period.label, value: payload.metrics.netProfit ?? payload.metrics.profitAfterMarketingSpend };
        })),
        Promise.all(previousPeriods.map(async (period) => {
          const response = await fetch(`/api/analytics/pnl?from=${period.start}&to=${period.end}`, { signal: controller.signal });
          if (!response.ok) return { label: period.label, value: 0 };
          const payload = await response.json() as PnlData;
          return { label: period.label, value: payload.metrics.netProfit ?? payload.metrics.profitAfterMarketingSpend };
        })),
      ]).then(([comparison, currentProfit, previousProfit]) => { setComparisonData(comparison); setProfitTrends({ current: currentProfit, previous: previousProfit }); }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") { setComparisonData(null); setProfitTrends({ current: [], previous: [] }); } }).finally(() => { if (!controller.signal.aborted) setTrendLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [attributionModel, comparisonMode, country, product, groupBy, data?.period?.start, data?.period?.end]);

  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const campaignUrl = buildCampaignUrl(campaignBuilder.baseUrl, campaignBuilder);
  const updateCampaignBuilder = (field: keyof typeof campaignBuilder, value: string) => { setCampaignBuilder((current) => ({ ...current, [field]: value })); setCampaignUrlStatus(""); };
  const copyCampaignUrl = async () => {
    if (!campaignUrl.ok) return;
    try { await navigator.clipboard.writeText(campaignUrl.url); setCampaignUrlStatus("Campaign URL copied"); }
    catch { setCampaignUrlStatus("Copy failed. Select the URL and copy it manually."); }
  };
  const dimensionFiltered = country !== "all" || product !== "all";
  const contributionReady = Boolean(!dimensionFiltered && profitData?.availability.marketingSpend && profitData.availability.shippingCosts && profitData.availability.handlingCosts);
  const coreMetrics = data ? [
    ["Attributed orders", data.totals.attributedOrders.toLocaleString(), `${data.totals.orders.toLocaleString()} valid orders total`],
    ["Net sales", formatter.format(data.totals.sales), `${data.rows.length.toLocaleString()} normalized groups`],
    ["New-customer sales", formatter.format(data.totals.newCustomerSales), attributionModel === "last_touch" ? "Last-touch customer journey" : "First-touch customer journey"],
    ["Gross profit", !dimensionFiltered && profitData?.hasData ? formatter.format(profitData.metrics.grossProfit) : "—", dimensionFiltered ? "Filtered profit allocation is the next reporting layer" : profitData?.metrics.missingCostLines ? `${profitData.metrics.missingCostLines.toLocaleString()} lines need costs` : "Selected-period product costs"],
    ["Contribution margin", contributionReady && profitData ? formatter.format(profitData.metrics.contributionMargin) : "—", contributionReady && profitData && profitData.metrics.contributionMarginPercentage !== null ? `${(profitData.metrics.contributionMarginPercentage * 100).toFixed(1)}% of net product sales` : "Complete marketing, shipping and handling costs"],
    ["Average order value", formatter.format(data.totals.averageOrderValue), `${data.totals.customers.toLocaleString()} identified customers`],
    ["Revenue per customer", data.totals.revenuePerCustomer === null ? "—" : formatter.format(data.totals.revenuePerCustomer), "Identified customers only"],
  ] : [["Attributed orders", "319", "All valid orders shown"], ["Net sales", "£204,050", "79% of net sales"], ["New-customer sales", "£146,920", "72% of attributed"], ["Gross profit", "—", "Add product costs"], ["Contribution margin", "—", "Complete direct costs"], ["Average order value", "£640", "Across valid orders"], ["Revenue per customer", "£820", "Identified customers"]];
  const baseRows = data?.hasData ? data.rows : utms.map(([source, medium, campaign, sales, orders, aov]) => ({ channel: "Attributed", source, medium, campaign, content: "—", term: "—", landingPage: "Unknown", customerType: "New", sales: Number(String(sales).replace(/[^0-9.-]/g, "")), refunds: 0, cogs: 0, missingCostUnits: 0, marketingCost: null, orders: Number(orders), customers: Number(orders), newCustomerSales: 0, averageOrderValue: Number(aov.replace(/[^0-9]/g, "")), revenuePerCustomer: null }));
  const groupCostsReady = Boolean(!dimensionFiltered && profitData?.availability.transactionFees && profitData.availability.shippingCosts && profitData.availability.handlingCosts);
  const rows = baseRows.map((row) => {
    const share = data?.totals.sales ? row.sales / data.totals.sales : 0;
    const marketingCost = dimensionFiltered ? null : row.marketingCost;
    const transactionCost = !dimensionFiltered && profitData?.availability.transactionFees ? profitData.metrics.transactionFees * share : null;
    const shippingCost = !dimensionFiltered && profitData?.availability.shippingCosts ? profitData.metrics.merchantShippingCosts * share : null;
    const handlingCost = !dimensionFiltered && profitData?.availability.handlingCosts ? profitData.metrics.handlingCosts * share : null;
    const contributionProfit = groupCostsReady && row.missingCostUnits === 0 && marketingCost !== null && transactionCost !== null && shippingCost !== null && handlingCost !== null ? row.sales - row.refunds - row.cogs - marketingCost - transactionCost - shippingCost - handlingCost : null;
    const mappedSales = marketingCost === null ? null : Math.max(row.sales - row.refunds, 0);
    const roas = marketingCost && mappedSales !== null ? mappedSales / marketingCost : null;
    const mappedNewCustomers = marketingCost !== null && row.customerType === "New" ? row.customers : 0;
    const cac = marketingCost !== null && mappedNewCustomers > 0 ? marketingCost / mappedNewCustomers : null;
    return { ...row, marketingCost, contributionProfit, roas, cac, newCustomerMix: row.sales ? row.newCustomerSales / row.sales : null };
  });
  const mappedRows = rows.filter((row) => row.marketingCost !== null);
  const mappedSales = mappedRows.reduce((sum, row) => sum + Math.max(row.sales - row.refunds, 0), 0);
  const mappedSpend = mappedRows.reduce((sum, row) => sum + (row.marketingCost ?? 0), 0);
  const mappedNewCustomers = mappedRows.reduce((sum, row) => sum + (row.customerType === "New" ? row.customers : 0), 0);
  const mappedProfitReady = mappedRows.length > 0 && mappedRows.every((row) => row.contributionProfit !== null);
  const mappedProfit = mappedProfitReady ? mappedRows.reduce((sum, row) => sum + (row.contributionProfit ?? 0), 0) : null;
  const metrics = data ? [...coreMetrics,
    ["Mapped ROAS", mappedSpend > 0 && mappedSales > 0 ? `${(mappedSales / mappedSpend).toFixed(2)}x` : "—", mappedSpend > 0 ? `${formatter.format(mappedSpend)} mapped spend` : "Map campaign spend to attributed traffic"],
    ["MER on mapped spend", data.mappingCoverage.mappedSpend > 0 ? `${(data.totals.sales / data.mappingCoverage.mappedSpend).toFixed(2)}x` : "—", data.mappingCoverage.mappedSpend > 0 ? "All net sales divided by mapped spend" : "Unavailable without mapped spend"],
    ["Mapped CAC", mappedSpend > 0 && mappedNewCustomers > 0 ? formatter.format(mappedSpend / mappedNewCustomers) : "—", mappedNewCustomers > 0 ? `${mappedNewCustomers.toLocaleString()} mapped new customers` : "Unavailable without mapped new-customer traffic"],
    ["Profit after mapped spend", mappedProfit === null ? "—" : formatter.format(mappedProfit), mappedProfit === null ? "Requires mapped spend and complete direct costs" : "Mapped groups after refunds, COGS and direct costs"],
  ] : coreMetrics;
  const sources = [...new Set(rows.map((row) => row.source || "Unknown"))].sort();
  const mediums = [...new Set(rows.map((row) => row.medium || "Unknown"))].sort();
  const campaigns = [...new Set(rows.map((row) => row.campaign || "Unknown"))].sort();
  const landingPages = [...new Set(rows.map((row) => row.landingPage))].sort();
  const customerTypes = [...new Set(rows.map((row) => row.customerType))].sort();
  const countries = data?.filterOptions.countries ?? [];
  const products = data?.filterOptions.products ?? [];
  const mappingTargets = [...new Map(rows.map((row) => { const value = JSON.stringify([row.source, row.medium, row.campaign]); return [value, { value, label: `${row.source} / ${row.medium} / ${row.campaign}` }]; })).values()].sort((left, right) => left.label.localeCompare(right.label));
  const saveMapping = async () => {
    if (!mappingForm.externalCampaignId || !mappingForm.target) return;
    setMappingSaving(true); setMappingError("");
    try {
      const [utmSource, utmMedium, utmCampaign] = JSON.parse(mappingForm.target) as string[];
      const response = await fetch("/api/settings/campaign-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalCampaignId: mappingForm.externalCampaignId, utmSource, utmMedium, utmCampaign }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save campaign mapping");
      setMappingForm({ externalCampaignId: "", target: "" }); await loadMappings(); setMappingRevision((revision) => revision + 1);
    } catch (reason) { setMappingError(reason instanceof Error ? reason.message : "Could not save campaign mapping"); }
    finally { setMappingSaving(false); }
  };
  const deleteMapping = async (id: string) => {
    setMappingSaving(true); setMappingError("");
    try {
      const response = await fetch(`/api/settings/campaign-mappings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || "Could not remove campaign mapping"); }
      await loadMappings(); setMappingRevision((revision) => revision + 1);
    } catch (reason) { setMappingError(reason instanceof Error ? reason.message : "Could not remove campaign mapping"); }
    finally { setMappingSaving(false); }
  };
  const prepareCustomSpend = async (file: File) => {
    setCustomSpendStatus("");
    setCustomSpendPreview(null);
    try {
      const draft = parseCustomSpendCsv(await file.text(), file.name);
      setCustomSpendDraft(draft);
      const missing = customSpendColumnFields.filter((field) => field.required && draft.mapping[field.key] < 0);
      setCustomSpendStatus(missing.length ? "Map the required columns, then preview the import." : "Review the detected columns, then preview the import.");
    } catch (reason) {
      setCustomSpendDraft(null);
      setCustomSpendStatus(reason instanceof Error ? reason.message : "Could not read custom spend CSV");
    }
  };
  const updateCustomSpendMapping = (key: CustomSpendColumnKey, index: number) => {
    setCustomSpendDraft((draft) => draft ? { ...draft, mapping: { ...draft.mapping, [key]: index } } : null);
    setCustomSpendPreview(null);
  };
  const previewCustomSpend = () => {
    if (!customSpendDraft) return;
    const result = buildCustomSpendRows(customSpendDraft, customSpendDraft.mapping, data?.currency || "GBP");
    if (!result.ok) {
      setCustomSpendPreview(null);
      setCustomSpendStatus(result.error);
      return;
    }
    setCustomSpendPreview({ filename: customSpendDraft.filename, rows: result.rows });
    setCustomSpendStatus(`${result.rows.length.toLocaleString()} rows are ready to import.`);
  };
  const importCustomSpend = async () => {
    if (!customSpendPreview) return;
    setCustomSpendImporting(true); setCustomSpendStatus("");
    try {
      const response = await fetch("/api/settings/custom-spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(customSpendPreview) });
      const payload = await response.json() as { error?: string; batch?: { inserted_count: number; updated_count: number } };
      if (!response.ok) throw new Error(payload.error || "Could not import custom spend");
      setCustomSpendStatus(`${payload.batch?.inserted_count ?? 0} new and ${payload.batch?.updated_count ?? 0} updated spend rows imported`);
      setCustomSpendPreview(null); setCustomSpendDraft(null); await loadCustomSpend(); setMappingRevision((revision) => revision + 1);
    } catch (reason) { setCustomSpendStatus(reason instanceof Error ? reason.message : "Could not import custom spend"); }
    finally { setCustomSpendImporting(false); }
  };
  const rollbackCustomSpend = async (batchId: string) => {
    setCustomSpendImporting(true); setCustomSpendStatus("");
    try {
      const response = await fetch(`/api/settings/custom-spend?batchId=${encodeURIComponent(batchId)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string; restoredRows?: number };
      if (!response.ok) throw new Error(payload.error || "Could not roll back this import");
      setCustomSpendStatus(`Import rolled back · ${payload.restoredRows ?? 0} overwritten rows restored`);
      await loadCustomSpend(); setMappingRevision((revision) => revision + 1);
    } catch (reason) { setCustomSpendStatus(reason instanceof Error ? reason.message : "Could not roll back this import"); }
    finally { setCustomSpendImporting(false); }
  };
  const latestActiveCustomSpendBatchId = customSpendBatches.find((batch) => !batch.rolled_back_at)?.id ?? null;
  const visibleRows = rows.filter((row) => `${row.channel} ${row.source} ${row.medium} ${row.campaign} ${row.content} ${row.term} ${row.landingPage}`.toLowerCase().includes(search.trim().toLowerCase()) && (source === "all" || row.source === source) && (medium === "all" || row.medium === medium) && (campaign === "all" || row.campaign === campaign) && (landingPage === "all" || row.landingPage === landingPage) && (customerType === "all" || row.customerType === customerType));
  const currentUtmTrends = data?.trends.slice(-12) ?? [];
  const previousUtmTrends = comparisonData?.trends.slice(-12) ?? [];
  const trendLabels = trendMetric === "profit" ? profitTrends.current.map((trend) => trend.label) : currentUtmTrends.map((trend) => trend.period);
  const utmTrendValue = (trend: UtmData["trends"][number]) => trendMetric === "sales" ? trend.sales : trendMetric === "orders" ? trend.orders : trend.customers;
  const currentTrendValues = trendMetric === "profit" ? profitTrends.current.map((trend) => trend.value) : currentUtmTrends.map(utmTrendValue);
  const previousTrendValues = trendMetric === "profit" ? profitTrends.previous.map((trend) => trend.value) : previousUtmTrends.map(utmTrendValue);
  const trendMaximum = Math.max(...currentTrendValues.map((value) => Math.max(value, 0)), ...previousTrendValues.map((value) => Math.max(value, 0)), 1);
  const formatTrendValue = (value: number) => trendMetric === "sales" || trendMetric === "profit" ? formatter.format(value) : value.toLocaleString();
  const utmExportRows = [["Report", "UTM analysis"], ["Attribution model", attributionModel === "last_touch" ? "Last touch" : "First touch"], ["Period", data?.period ? `${data.period.start} to ${data.period.end}` : "No imported orders"], ["Timezone", data?.timezone || "UTC"], ["Currency", data?.currency || "GBP"], ["Filters", [search.trim() ? `Search: ${search.trim()}` : "", source !== "all" ? `Source: ${source}` : "", medium !== "all" ? `Medium: ${medium}` : "", campaign !== "all" ? `Campaign: ${campaign}` : "", landingPage !== "all" ? `Landing page: ${landingPage}` : "", customerType !== "all" ? `Customer type: ${customerType}` : "", country !== "all" ? `Country: ${country}` : "", product !== "all" ? `Product: ${product}` : "", `Comparison: ${comparisonMode === "previous_year" ? "previous year" : "previous period"}`].filter(Boolean).join(" · ") || "None"], ["Generated at", new Date().toISOString()], [], ["Channel", "Source", "Medium", "Campaign", "Content", "Term", "Landing page", "Customer type", "Net sales", "Refunds", "COGS", "Marketing cost", "ROAS", "CAC", "Contribution profit", "Orders", "Customers", "Average order value", "Revenue per customer", "New-customer sales", "New-customer mix"], ...visibleRows.map((row) => [row.channel, row.source, row.medium, row.campaign, row.content, row.term, row.landingPage, row.customerType, row.sales, row.refunds, row.cogs, row.marketingCost ?? "", row.roas ?? "", row.cac ?? "", row.contributionProfit ?? "", row.orders, row.customers, row.averageOrderValue, row.revenuePerCustomer ?? "", row.newCustomerSales, row.newCustomerMix ?? ""])];
  const exportUtm = () => downloadCsv("utm-analysis.csv", utmExportRows);
  const exportUtmXlsx = () => downloadXlsx("utm-analysis.xlsx", utmExportRows, { sheetName: "UTM analysis", headerRow: 8, columnStyles: { 8: "currency", 9: "currency", 10: "currency", 11: "currency", 13: "currency", 14: "currency", 17: "currency", 18: "currency", 19: "currency", 20: "percentage" } });
  const saveCurrentUtmView = async () => {
    const name = window.prompt("Name this UTM report", "UTM performance");
    if (!name?.trim()) return;
    setSaveViewStatus("Saving…");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: "Saved from UTM Analysis", reportType: "utm", visibility: "private", datePreset: "all_imported", utmFilters: { fromDate, toDate, source, medium, campaign, landingPage, customerType, country, product, comparisonMode, attributionModel } }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save this UTM view");
      setSaveViewStatus("Saved to Reports");
    } catch (reason) { setSaveViewStatus(reason instanceof Error ? reason.message : "Could not save this UTM view"); }
  };
  const diagnosticItems = data ? [["No attribution record", data.diagnostics.missingAttribution], ["No UTM parameters", data.diagnostics.missingUtm], ["No landing page", data.diagnostics.missingLandingPage], ["No referrer", data.diagnostics.missingReferrer]] as const : [];
  return <>
    <FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={(preset) => { setDatePreset(preset); if (preset !== "custom") { const range = financeDateRange(preset); setLoading(true); setFromDate(range.from); setToDate(range.to); } }} onFrom={(value) => { setDatePreset("custom"); setLoading(true); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setLoading(true); setToDate(value); }} groupBy={groupBy} onGroupBy={setGroupBy}/>
    {loading ? <div className="data-loading">Loading Shopify attribution…</div> : data && !data.hasData ? <div className="connection-notice"><Info/><div><strong>Shopify attribution will appear after an order sync</strong><span>This report uses the selected Shopify customer journey model.</span></div></div> : null}
    <section className="metric-grid compact">{metrics.map(([label, value, hint]) => <article className="metric-card" key={label}><div className="metric-head"><span>{label}</span></div><strong>{value}</strong><div className="metric-foot"><span>{hint}</span></div></article>)}</section>
    {trendLabels.length ? <section className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">MONTHLY TREND</span><h2>{trendMetric === "sales" ? "Net sales" : trendMetric === "orders" ? "Orders" : trendMetric === "customers" ? "Customers" : "Profit"} versus previous period</h2></div><div className="feature-actions"><div className="legend"><span className="blue-dot"/>Current <span className="green-dot"/>{comparisonMode === "previous_year" ? "Previous year" : "Previous period"}</div><select aria-label="UTM trend metric" value={trendMetric} onChange={(event) => setTrendMetric(event.target.value as "sales" | "orders" | "customers" | "profit")}><option value="sales">Net sales</option><option value="orders">Orders</option><option value="customers">Customers</option><option value="profit" disabled={dimensionFiltered}>Profit</option></select></div></div>{trendLoading ? <div className="data-loading">Calculating period comparison…</div> : <div className="chart-wrap"><div className="y-axis"><span>{formatTrendValue(trendMaximum)}</span><span>{formatTrendValue(trendMaximum / 2)}</span><span>{formatTrendValue(trendMaximum / 4)}</span><span>{formatTrendValue(0)}</span></div><div className="bar-chart">{trendLabels.map((label, index) => <div className="bar-group" key={`${label}-${index}`} title={`Current ${formatTrendValue(currentTrendValues[index] ?? 0)} · Previous ${formatTrendValue(previousTrendValues[index] ?? 0)}`}><div className="bars"><i className="revenue" style={{height:`${Math.max(currentTrendValues[index] ?? 0, 0) / trendMaximum * 100}%`}}/><i className="profit" style={{height:`${Math.max(previousTrendValues[index] ?? 0, 0) / trendMaximum * 100}%`}}/></div><span>{label}</span></div>)}</div></div>}</section> : null}
    {data && diagnosticItems.some(([, diagnostic]) => diagnostic.orders > 0) ? <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">ATTRIBUTION COVERAGE</span><h2>Unattributed-sales diagnostic</h2></div><span className="report-note">An order can appear in more than one gap when Shopify did not record several journey fields.</span></div><div className="report-summary">{diagnosticItems.map(([label, diagnostic]) => <div key={label}><span>{label}</span><strong>{diagnostic.orders.toLocaleString()} orders</strong><small>{formatter.format(diagnostic.sales)} net sales</small></div>)}</div></section> : null}
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CAMPAIGN URL BUILDER</span><h2>Create consistently named tracking links</h2></div><span className="report-note">Values are normalized to lowercase words separated by underscores so future campaign matching stays predictable.</span></div>
      <div className="form-grid"><label className="form-field"><span>Landing-page URL</span><input type="url" value={campaignBuilder.baseUrl} onChange={(event) => updateCampaignBuilder("baseUrl", event.target.value)} placeholder="https://example.com/products/widget"/></label><label className="form-field"><span>Source</span><input value={campaignBuilder.source} onChange={(event) => updateCampaignBuilder("source", event.target.value)} placeholder="meta"/></label><label className="form-field"><span>Medium</span><input value={campaignBuilder.medium} onChange={(event) => updateCampaignBuilder("medium", event.target.value)} placeholder="paid_social"/></label><label className="form-field"><span>Campaign</span><input value={campaignBuilder.campaign} onChange={(event) => updateCampaignBuilder("campaign", event.target.value)} placeholder="summer_sale_uk"/></label><label className="form-field"><span>Content (optional)</span><input value={campaignBuilder.content} onChange={(event) => updateCampaignBuilder("content", event.target.value)} placeholder="carousel_a"/></label><label className="form-field"><span>Term (optional)</span><input value={campaignBuilder.term} onChange={(event) => updateCampaignBuilder("term", event.target.value)} placeholder="running_shoes"/></label></div>
      {campaignUrl.ok ? <div className="connected-account"><span/><div><small>TRACKING URL</small><strong><code>{campaignUrl.url}</code></strong><small>{campaignUrlStatus || "Existing landing-page parameters and fragments are preserved."}</small></div><button className="primary" onClick={() => void copyCampaignUrl()}>Copy URL</button></div> : campaignBuilder.baseUrl || campaignBuilder.source || campaignBuilder.medium || campaignBuilder.campaign ? <div className="connection-notice"><Info/><div><strong>Complete the required fields</strong><span>{campaignUrl.error}</span></div></div> : null}
    </section>
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CAMPAIGN SPEND MAPPING</span><h2>Connect Meta campaigns to UTM traffic</h2></div><span className="report-note">{data ? `${data.mappingCoverage.mappedCampaigns.toLocaleString()} of ${data.mappingCoverage.importedCampaigns.toLocaleString()} Meta campaigns mapped · ${data.mappingCoverage.customSpendRows.toLocaleString()} custom spend rows · ${formatter.format(data.mappingCoverage.allocatedSpend)} allocated · ${formatter.format(data.mappingCoverage.unallocatedSpend)} unallocated` : "Load attribution data to review spend coverage."}</span></div>
      {mappingError ? <div className="connection-notice"><Info/><div><strong>Campaign mapping needs attention</strong><span>{mappingError}</span></div></div> : null}
      {mappingData?.canManage && mappingData.campaigns.length > 0 && mappingTargets.length > 0 ? <div className="filter-row"><select aria-label="Meta campaign" value={mappingForm.externalCampaignId} onChange={(event) => setMappingForm((current) => ({ ...current, externalCampaignId: event.target.value }))}><option value="">Choose Meta campaign</option>{mappingData.campaigns.map((item) => <option key={item.campaign_id} value={item.campaign_id}>{item.campaign_name}</option>)}</select><select aria-label="UTM target" value={mappingForm.target} onChange={(event) => setMappingForm((current) => ({ ...current, target: event.target.value }))}><option value="">Choose UTM source / medium / campaign</option>{mappingTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select><button disabled={mappingSaving || !mappingForm.externalCampaignId || !mappingForm.target} onClick={() => void saveMapping()}>{mappingSaving ? "Saving…" : "Save mapping"}</button></div> : null}
      {mappingData && mappingData.campaigns.length === 0 ? <div className="connection-notice"><Info/><div><strong>Import campaign-level Meta data</strong><span>Reconnect or run the Meta import once after this update, then campaign names will be available to map.</span></div></div> : null}
      {mappingData?.canManage ? <>
        <div className="filter-row">
          <label>Custom spend CSV<input type="file" accept=".csv,text/csv" disabled={customSpendImporting} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void prepareCustomSpend(file); }}/></label>
          <span className="report-note">{customSpendStatus || "Upload a CSV, map its columns, review the preview, then import."}</span>
        </div>
        {customSpendDraft ? <div className="custom-spend-mapper">
          <div className="custom-spend-mapper-head"><div><strong>Map columns</strong><span>{customSpendDraft.filename} · {customSpendDraft.rows.length.toLocaleString()} rows</span></div></div>
          <div className="filter-row">{customSpendColumnFields.map((field) => <label key={field.key}>{field.label}{field.required ? " *" : ""}
            <select aria-label={`Map ${field.label}`} value={customSpendDraft.mapping[field.key]} onChange={(event) => updateCustomSpendMapping(field.key, Number(event.target.value))}>
              <option value={-1}>{field.required ? "Choose column" : "Not imported"}</option>
              {customSpendDraft.headers.map((header, index) => <option key={`${field.key}-${index}`} value={index}>{header}</option>)}
            </select>
          </label>)}</div>
          <div className="table-footer"><span>* Required. Unmapped currency uses {data?.currency || "GBP"}.</span><div className="feature-actions"><button disabled={customSpendImporting} onClick={() => { setCustomSpendDraft(null); setCustomSpendPreview(null); setCustomSpendStatus(""); }}>Cancel</button><button className="primary" disabled={customSpendImporting} onClick={previewCustomSpend}>Preview rows</button></div></div>
        </div> : null}
        {customSpendPreview ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Source</th><th>Medium</th><th>Campaign</th><th>Spend</th><th>Currency</th></tr></thead><tbody>{customSpendPreview.rows.slice(0, 5).map((row, index) => <tr key={`${row.date}-${row.source}-${index}`}><td>{row.date}</td><td>{row.source}</td><td>{row.medium || "(none)"}</td><td>{row.campaign || "(not set)"}</td><td>{row.spend}</td><td>{row.currency}</td></tr>)}</tbody></table><div className="table-footer"><span>Previewing {Math.min(customSpendPreview.rows.length, 5)} of {customSpendPreview.rows.length} rows from {customSpendPreview.filename}</span><div className="feature-actions"><button disabled={customSpendImporting} onClick={() => setCustomSpendPreview(null)}>Edit mapping</button><button className="primary" disabled={customSpendImporting} onClick={() => void importCustomSpend()}>{customSpendImporting ? "Importing…" : "Import rows"}</button></div></div></div> : null}
        {customSpendBatches.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Recent import</th><th>Rows</th><th>Result</th><th>Imported</th><th/></tr></thead><tbody>{customSpendBatches.slice(0, 5).map((batch) => <tr key={batch.id}><td>{batch.original_filename}</td><td>{batch.row_count.toLocaleString()}</td><td>{batch.rolled_back_at ? "Rolled back" : `${batch.inserted_count} new · ${batch.updated_count} updated`}</td><td>{new Date(batch.created_at).toLocaleString("en-GB")}</td><td>{!batch.rolled_back_at && (batch.id === latestActiveCustomSpendBatchId ? <button className="danger-button" disabled={customSpendImporting} onClick={() => void rollbackCustomSpend(batch.id)}>Roll back</button> : <span className="muted">Rollback newer first</span>)}</td></tr>)}</tbody></table></div> : null}
      </> : null}
      {mappingData?.mappings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Platform campaign</th><th>UTM source</th><th>UTM medium</th><th>UTM campaign</th>{mappingData.canManage ? <th>Action</th> : null}</tr></thead><tbody>{mappingData.mappings.map((mapping) => <tr key={mapping.id}><td><strong>{mapping.external_campaign_name}</strong></td><td>{mapping.utm_source}</td><td>{mapping.utm_medium}</td><td>{mapping.utm_campaign}</td>{mappingData.canManage ? <td><button aria-label={`Remove ${mapping.external_campaign_name} mapping`} disabled={mappingSaving} onClick={() => void deleteMapping(mapping.id)}><Trash2/> Remove</button></td> : null}</tr>)}</tbody></table></div> : <div className="table-footer"><span>No campaign mappings yet.</span></div>}
    </section>
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">{attributionModel === "last_touch" ? "LAST-TOUCH ATTRIBUTION" : "FIRST-TOUCH ATTRIBUTION"}</span><h2>Sales by UTM</h2></div><div className="feature-actions"><span className="report-note">{saveViewStatus || (dimensionFiltered ? "Revenue filters apply; group profit waits for filtered cost allocation." : "Contribution profit uses exact refunds and COGS plus proportional marketing, payment, shipping, and handling costs.")}</span><button onClick={() => void saveCurrentUtmView()}><Plus/> Save view</button><button className="export-button" disabled={!rows.length} onClick={exportUtmXlsx}><Download/> Export XLSX</button><button className="export-button" disabled={!rows.length} onClick={exportUtm}><Download/> Export CSV</button></div></div>
      <div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search UTM dimensions..."/></div><select aria-label="UTM source" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="UTM medium" value={medium} onChange={(event) => setMedium(event.target.value)}><option value="all">All media</option>{mediums.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="UTM campaign" value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Landing page" value={landingPage} onChange={(event) => setLandingPage(event.target.value)}><option value="all">All landing pages</option>{landingPages.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Customer type" value={customerType} onChange={(event) => setCustomerType(event.target.value)}><option value="all">All customers</option>{customerTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Country" value={country} onChange={(event) => { setCountry(event.target.value); if (event.target.value !== "all" && trendMetric === "profit") setTrendMetric("sales"); }}><option value="all">All countries</option>{countries.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Product" value={product} onChange={(event) => { setProduct(event.target.value); if (event.target.value !== "all" && trendMetric === "profit") setTrendMetric("sales"); }}><option value="all">All products</option>{products.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Comparison period" value={comparisonMode} onChange={(event) => setComparisonMode(event.target.value as "previous_period" | "previous_year")}><option value="previous_period">Previous period</option><option value="previous_year">Previous year</option></select><select aria-label="Attribution model" value={attributionModel} onChange={(event) => setAttributionModel(event.target.value as "first_touch" | "last_touch")}><option value="last_touch">Last-touch attribution</option><option value="first_touch">First-touch attribution</option></select></div>
      <div className="table-scroll"><table className="data-table utm-table"><thead><tr><th>Channel</th><th>Source</th><th>Medium</th><th>Campaign</th><th>Content</th><th>Term</th><th>Landing page</th><th>Customer type</th><th>Net sales</th><th>Refunds</th><th>COGS</th><th>Marketing cost</th><th>ROAS</th><th>CAC</th><th>Contribution profit</th><th>Orders</th><th>Customers</th><th>AOV</th><th>Revenue/customer</th><th>New-customer sales</th><th>New-customer mix</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={`${row.channel}-${row.source}-${row.medium}-${row.campaign}-${row.content}-${row.term}-${row.landingPage}-${row.customerType}`}><td>{row.channel}</td><td><span className="utm-source"><i/>{row.source}</span></td><td>{row.medium}</td><td>{row.campaign}</td><td>{row.content}</td><td>{row.term}</td><td>{row.landingPage}</td><td>{row.customerType}</td><td><strong>{formatter.format(Number(row.sales))}</strong></td><td>{row.refunds ? formatter.format(-row.refunds) : "—"}</td><td>{row.missingCostUnits ? <span title={`${row.missingCostUnits.toLocaleString()} units need costs`}>Partial · {formatter.format(-row.cogs)}</span> : formatter.format(-row.cogs)}</td><td>{row.marketingCost === null ? "—" : formatter.format(-row.marketingCost)}</td><td>{row.roas === null ? "—" : `${row.roas.toFixed(2)}x`}</td><td>{row.cac === null ? "—" : formatter.format(row.cac)}</td><td>{row.contributionProfit === null ? "—" : <strong>{formatter.format(row.contributionProfit)}</strong>}</td><td>{row.orders.toLocaleString()}</td><td>{row.customers.toLocaleString()}</td><td>{formatter.format(row.averageOrderValue)}</td><td>{row.revenuePerCustomer === null ? "—" : formatter.format(row.revenuePerCustomer)}</td><td>{formatter.format(row.newCustomerSales)}</td><td>{row.newCustomerMix === null ? "—" : `${(row.newCustomerMix * 100).toFixed(1)}%`}</td></tr>) : <tr><td colSpan={21} className="empty-row">No UTM groups match that filter.</td></tr>}</tbody></table></div>
      <div className="table-footer"><span>{data?.hasData ? `Showing ${visibleRows.length.toLocaleString()} of ${data.rows.length.toLocaleString()} UTM combinations` : "Preview data while you explore"}</span></div>
    </section>
  </>;
}

type CostVariant = { id: string; title: string; sku: string | null; price: string; shopify_unit_cost: string | null; currency: string; productTitle: string };
type ProductCost = { id: string; variant_id: string | null; sku: string | null; source: string; amount: string; currency: string; effective_from: string; effective_to: string | null; notes: string | null };
type ProductShippingCost = { id: string; variant_id: string | null; sku: string | null; allocation_basis: "orders" | "units"; amount: string; currency: string; effective_from: string; effective_to: string | null; notes: string | null };
type CostAuditEvent = { id: string; action: "created" | "updated" | "deleted"; previous_value: { amount?: string; effective_to?: string | null; notes?: string | null } | null; next_value: { amount?: string; effective_to?: string | null; notes?: string | null } | null; created_at: string };

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function Costs({ focusSku }: { focusSku?: string | null }) {
  const [variants, setVariants] = useState<CostVariant[]>([]);
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [shippingCosts, setShippingCosts] = useState<ProductShippingCost[]>([]);
  const [missingCostImpact, setMissingCostImpact] = useState({ orders: 0, units: 0, revenue: 0 });
  const [currency, setCurrency] = useState("GBP");
  const [canEdit, setCanEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddShipping, setShowAddShipping] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [costSearch, setCostSearch] = useState(focusSku ?? "");
  const [editingCost, setEditingCost] = useState<ProductCost | null>(null);
  const [auditEvents, setAuditEvents] = useState<CostAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [shippingForm, setShippingForm] = useState({ variantId: "", amount: "", allocationBasis: "units", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });
  const [editForm, setEditForm] = useState({ amount: "", effectiveTo: "", notes: "" });

  const load = () => Promise.all([
    fetch("/api/costs").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load costs"); return payload; }),
    fetch("/api/costs/shipping").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load shipping costs"); return payload; }),
  ]).then(([payload, shippingPayload]) => {
    setError(""); setVariants(payload.variants ?? []); setCosts(payload.costs ?? []); setShippingCosts(shippingPayload.costs ?? []); setMissingCostImpact(payload.missingCostImpact ?? { orders: 0, units: 0, revenue: 0 }); setCurrency(payload.currency ?? "GBP"); setCanEdit(Boolean(payload.canEdit && shippingPayload.canEdit));
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load costs"));

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!focusSku) return;
    const timeout = window.setTimeout(() => setCostSearch(focusSku), 0);
    return () => window.clearTimeout(timeout);
  }, [focusSku]);

  const saveItems = async (items: Array<Record<string, string | null>>, source: "manual" | "csv", filename?: string) => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, source, filename }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.join(" · ") || payload.error || "Could not save costs");
      await load();
      return payload.imported as number;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save costs");
      return 0;
    } finally { setSaving(false); }
  };

  const saveManual = async () => {
    const imported = await saveItems([{ variantId, amount, currency, effectiveFrom, effectiveTo: effectiveTo || null, notes: notes || null }], "manual");
    if (imported) { setShowAdd(false); setAmount(""); setEffectiveTo(""); setNotes(""); }
  };
  const saveShipping = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...shippingForm, currency, effectiveTo: shippingForm.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save shipping override");
      setShowAddShipping(false); setShippingForm({ ...shippingForm, variantId: "", amount: "", effectiveTo: "", notes: "" }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save shipping override"); } finally { setSaving(false); }
  };
  const deleteShipping = async (cost: ProductShippingCost) => {
    if (!window.confirm("Delete this shipping override?")) return;
    setError("");
    try {
      const response = await fetch(`/api/costs/shipping?id=${encodeURIComponent(cost.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete shipping override");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete shipping override"); }
  };
  const beginEdit = (cost: ProductCost) => {
    setEditingCost(cost); setEditForm({ amount: cost.amount, effectiveTo: cost.effective_to || "", notes: cost.notes || "" });
    setAuditEvents([]); setAuditLoading(true);
    fetch(`/api/costs?historyFor=${encodeURIComponent(cost.id)}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load cost history");
      setAuditEvents(payload.events ?? []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load cost history")).finally(() => setAuditLoading(false));
  };
  const saveEdit = async () => {
    if (!editingCost) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingCost.id, amount: editForm.amount, effectiveTo: editForm.effectiveTo || null, notes: editForm.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update cost");
      setEditingCost(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update cost"); } finally { setSaving(false); }
  };

  const importCsv = async (file: File) => {
    const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) { setError("The CSV needs a header and at least one data row"); return; }
    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/\s+/g, "_"));
    const required = ["sku", "amount", "effective_from"];
    const missing = required.filter((header) => !headers.includes(header));
    if (missing.length) { setError(`Missing CSV columns: ${missing.join(", ")}`); return; }
    const items = lines.slice(1).map((line) => {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
      return { sku: row.sku, amount: row.amount, currency: row.currency || currency, effectiveFrom: row.effective_from, effectiveTo: row.effective_to || null, notes: row.notes || null };
    }).filter((item) => item.sku && item.amount);
    if (!items.length) { setError("Add a cost amount beside at least one SKU before importing the template"); return; }
    await saveItems(items, "csv", file.name);
  };

  const currentDate = new Date().toISOString().slice(0, 10);
  const currentCosts = new Map(costs.filter((cost) => cost.effective_from <= currentDate && (!cost.effective_to || cost.effective_to >= currentDate)).map((cost) => [cost.variant_id ?? `sku:${cost.sku?.toLowerCase()}`, cost]));
  const currentShippingCosts = new Map(shippingCosts.filter((cost) => cost.effective_from <= currentDate && (!cost.effective_to || cost.effective_to >= currentDate)).map((cost) => [cost.variant_id ?? `sku:${cost.sku?.toLowerCase()}`, cost]));
  const staleVariants = variants.filter((variant) => {
    const key = variant.id;
    const skuKey = variant.sku ? `sku:${variant.sku.toLowerCase()}` : "";
    const records = costs.filter((cost) => cost.variant_id === key || (skuKey && `sku:${cost.sku?.toLowerCase()}` === skuKey));
    return records.length > 0 && !currentCosts.has(key) && !currentCosts.has(skuKey) && records.some((cost) => Boolean(cost.effective_to && cost.effective_to < currentDate));
  }).length;
  const covered = variants.filter((variant) => currentCosts.has(variant.id) || (variant.sku && currentCosts.has(`sku:${variant.sku.toLowerCase()}`)) || variant.shopify_unit_cost !== null).length;
  const missingVariants = variants.filter((variant) => !currentCosts.has(variant.id) && (!variant.sku || !currentCosts.has(`sku:${variant.sku.toLowerCase()}`)) && variant.shopify_unit_cost === null);
  const coverage = variants.length ? Math.round((covered / variants.length) * 100) : 0;
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const missingCostRows: Array<Array<string | number>> = [
    ["product", "variant", "sku", "amount", "currency", "effective_from", "effective_to", "notes"],
    ...missingVariants.map((variant) => [variant.productTitle, variant.title, variant.sku ?? "", "", variant.currency || currency, currentDate, "", ""]),
  ];
  const exportMissingCsv = () => downloadCsv("missing-product-cogs.csv", missingCostRows);
  const exportMissingXlsx = () => downloadXlsx("missing-product-cogs.xlsx", missingCostRows, { sheetName: "Missing COGS", headerRow: 1, columnStyles: { 4: "currency" } });
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });

  return <>
    <section className="cost-toolbar">
      <div><span className="eyebrow">COST ENGINE</span><h2>Product cost history</h2><p>Costs apply from their effective date, so future changes do not rewrite historical profit.</p></div>
      <div className="feature-actions"><button className="primary" disabled={!canEdit} onClick={()=>setShowAdd(true)}><Plus/> Add product cost</button><button disabled={!canEdit} onClick={() => setShowAddShipping(true)}><Plus/> Add shipping override</button><button disabled={missingVariants.length === 0} onClick={exportMissingCsv}><Download/> Missing COGS CSV</button><button disabled={missingVariants.length === 0} onClick={exportMissingXlsx}><Download/> Missing COGS Excel</button><label className={canEdit?"csv-button":"csv-button disabled"}><Upload/> Import CSV<input type="file" accept=".csv,text/csv" disabled={!canEdit || saving} onChange={(event)=>{const file=event.target.files?.[0];if(file) void importCsv(file);event.target.value="";}}/></label></div>
    </section>
    {error && <div className="connection-error cost-error">{error}</div>}
    <section className="cost-grid live"><div><strong>{variants.length.toLocaleString()}</strong><span>Variants synced</span></div><div><strong>{coverage}%</strong><span>Current cost coverage</span></div><div><strong>{Math.max(variants.length-covered,0).toLocaleString()}</strong><span>Missing costs</span></div><div><strong>{costs.length.toLocaleString()}</strong><span>Cost records</span></div></section>
    {missingCostImpact.orders > 0 && <div className="connection-notice cost-impact"><Info/><div><strong>Missing costs affect {formatter.format(missingCostImpact.revenue)} of imported sales</strong><span>{missingCostImpact.orders.toLocaleString()} orders and {missingCostImpact.units.toLocaleString()} units cannot yet have complete gross-profit calculations. Add an effective-dated product cost to resolve them.</span></div></div>}
    {staleVariants > 0 && <div className="connection-notice cost-impact"><Info/><div><strong>{staleVariants.toLocaleString()} product cost{staleVariants === 1 ? "" : "s"} need updating</strong><span>These variants have an expired cost record. Add a new effective-dated cost to keep future profitability up to date.</span></div></div>}
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CURRENT COVERAGE</span><h2>Variant cost coverage</h2></div><span className="report-note">Active manual costs take priority over Shopify&apos;s unit cost.</span></div>{variants.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Selling price</th><th>Shopify unit cost</th><th>Active override</th><th>Shipping override</th><th>Current source</th></tr></thead><tbody>{variants.map((variant) => { const override = currentCosts.get(variant.id) ?? (variant.sku ? currentCosts.get(`sku:${variant.sku.toLowerCase()}`) : undefined); const shippingOverride = currentShippingCosts.get(variant.id) ?? (variant.sku ? currentShippingCosts.get(`sku:${variant.sku.toLowerCase()}`) : undefined); const source = override ? override.source : variant.shopify_unit_cost !== null ? "shopify" : "missing"; return <tr key={variant.id}><td><strong>{variant.productTitle}</strong><small>{variant.title}</small></td><td>{variant.sku || "—"}</td><td>{formatter.format(Number(variant.price))}</td><td>{variant.shopify_unit_cost === null ? "—" : formatter.format(Number(variant.shopify_unit_cost))}</td><td>{override ? <strong>{formatter.format(Number(override.amount))}</strong> : "—"}</td><td>{shippingOverride ? <><strong>{formatter.format(Number(shippingOverride.amount))}</strong><small>per {shippingOverride.allocation_basis === "units" ? "unit" : "order"}</small></> : "Store fallback"}</td><td><span className={source === "missing" ? "cost-warning" : `source-pill ${source}`}>{source === "missing" ? "Needs cost" : source.replace("_", " ")}</span></td></tr>; })}</tbody></table></div> : null}</section>
    <section className="panel report-panel cost-table-panel"><div className="panel-head"><div><span className="eyebrow">EFFECTIVE-DATED RECORDS</span><h2>Product costs</h2></div><a className="template-link" href="data:text/csv;charset=utf-8,sku%2Camount%2Ccurrency%2Ceffective_from%2Ceffective_to%2Cnotes%0AEXAMPLE-SKU%2C12.50%2CGBP%2C2026-01-01%2C%2COptional%20note" download="product-cost-template.csv">Download CSV template</a></div><div className="filter-row"><div className="search"><Search/><input value={costSearch} onChange={(event) => setCostSearch(event.target.value)} placeholder="Find a product or SKU..."/></div></div>
      {variants.length===0?<div className="cost-empty"><WalletCards/><strong>No Shopify variants yet</strong><span>Connect Shopify and run the first sync before adding variant costs. CSV rows with a SKU can still be imported.</span></div>:<div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Source</th><th>Unit cost</th><th>Effective from</th><th>Effective to</th><th/></tr></thead><tbody>{costs.length===0?<tr><td colSpan={7} className="empty-row">No cost records yet. Add one manually or import the CSV template.</td></tr>:costs.filter((cost) => { const variant = cost.variant_id ? variantMap.get(cost.variant_id) : undefined; return `${variant?.productTitle ?? ""} ${variant?.title ?? ""} ${cost.sku ?? variant?.sku ?? ""}`.toLowerCase().includes(costSearch.toLowerCase()); }).map((cost)=>{const variant=cost.variant_id?variantMap.get(cost.variant_id):undefined;return <tr key={cost.id}><td><strong>{variant?.productTitle ?? "SKU fallback"}</strong><small>{variant?.title ?? cost.notes ?? "Unmatched variant"}</small></td><td>{cost.sku || variant?.sku || "—"}</td><td><span className={`source-pill ${cost.source}`}>{cost.source.replace("_"," ")}</span></td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td><td>{canEdit && <button onClick={() => beginEdit(cost)}>Edit</button>}</td></tr>})}</tbody></table></div>}
    </section>
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">SHIPPING OVERRIDES</span><h2>Variant shipping costs</h2><p>Overrides replace store-level fulfilment fallback rates for matching order lines.</p></div></div>{shippingCosts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Amount</th><th>Basis</th><th>Effective from</th><th>Effective to</th><th/></tr></thead><tbody>{shippingCosts.map((cost) => { const variant = cost.variant_id ? variantMap.get(cost.variant_id) : undefined; return <tr key={cost.id}><td><strong>{variant?.productTitle ?? "SKU fallback"}</strong><small>{variant?.title ?? cost.notes ?? "Unmatched variant"}</small></td><td>{cost.sku || variant?.sku || "—"}</td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>Per {cost.allocation_basis === "units" ? "unit" : "order"}</td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td><td>{canEdit && <button className="icon-button" aria-label="Delete shipping override" onClick={() => void deleteShipping(cost)}><Trash2/></button>}</td></tr>; })}</tbody></table></div> : <div className="cost-empty"><Package/><strong>No variant shipping overrides</strong><span>Store-level fulfilment expense rules remain the fallback until a matching override is added.</span></div>}</section>
    {showAdd&&<div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={()=>setShowAdd(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">COST ENGINE</span><h2>Add product cost</h2></div></div><p className="modal-intro">Choose a synced Shopify variant and the date this cost starts applying.</p>
      <label className="form-field"><span>Product variant</span><select value={variantId} onChange={(event)=>setVariantId(event.target.value)}><option value="">Select a variant</option>{variants.map((variant)=><option key={variant.id} value={variant.id}>{variant.productTitle} — {variant.title}{variant.sku?` (${variant.sku})`:""}</option>)}</select></label>
      <div className="cost-form-grid"><label className="form-field"><span>Unit cost</span><input inputMode="decimal" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="0.00"/></label><label className="form-field"><span>Currency</span><input value={currency} onChange={(event)=>setCurrency(event.target.value.toUpperCase())} maxLength={3}/></label><label className="form-field"><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(event)=>setEffectiveFrom(event.target.value)}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={effectiveTo} onChange={(event)=>setEffectiveTo(event.target.value)}/></label></div>
      <label className="form-field"><span>Notes <small>Optional</small></span><input value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Supplier, landed cost, or reason for change"/></label>
      {error&&<div className="connection-error">{error}</div>}<div className="modal-actions"><button onClick={()=>setShowAdd(false)}>Cancel</button><button className="primary" disabled={!variantId || !amount || saving} onClick={saveManual}>{saving?"Saving…":"Save cost"}</button></div>
    </section></div>}{showAddShipping && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowAddShipping(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><Package/></span><div><span className="eyebrow">SHIPPING COST</span><h2>Add variant override</h2></div></div><p className="modal-intro">This rate replaces store-level fulfilment fallback rules for the matching order line and date.</p><label className="form-field"><span>Product variant</span><select value={shippingForm.variantId} onChange={(event) => setShippingForm({ ...shippingForm, variantId: event.target.value })}><option value="">Select a variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productTitle} — {variant.title}{variant.sku ? ` (${variant.sku})` : ""}</option>)}</select></label><div className="cost-form-grid"><label className="form-field"><span>Shipping amount</span><input inputMode="decimal" value={shippingForm.amount} onChange={(event) => setShippingForm({ ...shippingForm, amount: event.target.value })} placeholder="0.00"/></label><label className="form-field"><span>Charge basis</span><select value={shippingForm.allocationBasis} onChange={(event) => setShippingForm({ ...shippingForm, allocationBasis: event.target.value })}><option value="units">Per unit</option><option value="orders">Per order</option></select></label><label className="form-field"><span>Effective from</span><input type="date" value={shippingForm.effectiveFrom} onChange={(event) => setShippingForm({ ...shippingForm, effectiveFrom: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={shippingForm.effectiveTo} onChange={(event) => setShippingForm({ ...shippingForm, effectiveTo: event.target.value })}/></label></div><label className="form-field"><span>Notes <small>Optional</small></span><input value={shippingForm.notes} onChange={(event) => setShippingForm({ ...shippingForm, notes: event.target.value })} placeholder="Carrier, service, or reason for override"/></label><div className="modal-actions"><button onClick={() => setShowAddShipping(false)}>Cancel</button><button className="primary" disabled={!shippingForm.variantId || !shippingForm.amount || saving} onClick={() => void saveShipping()}>{saving ? "Saving…" : "Save shipping override"}</button></div></section></div>}{editingCost && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setEditingCost(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">COST ENGINE</span><h2>Edit product cost</h2></div></div><p className="modal-intro">This updates the selected effective-dated record and saves an audit event.</p><div className="cost-form-grid"><label className="form-field"><span>Unit cost</span><input inputMode="decimal" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={editForm.effectiveTo} onChange={(event) => setEditForm({ ...editForm, effectiveTo: event.target.value })}/></label></div><label className="form-field"><span>Notes <small>Optional</small></span><input value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}/></label><section className="audit-history"><span className="eyebrow">AUDIT HISTORY</span>{auditLoading ? <p>Loading change history…</p> : auditEvents.length ? <ul>{auditEvents.map((event) => <li key={event.id}><strong>{event.action === "updated" ? "Updated" : event.action === "created" ? "Created" : "Deleted"}</strong><span>{new Date(event.created_at).toLocaleString("en-GB")}{event.action === "updated" && event.previous_value?.amount !== event.next_value?.amount ? ` · ${formatter.format(Number(event.previous_value?.amount || 0))} → ${formatter.format(Number(event.next_value?.amount || 0))}` : ""}</span></li>)}</ul> : <p>No recorded changes yet.</p>}</section><div className="modal-actions"><button onClick={() => setEditingCost(null)}>Cancel</button><button className="primary" disabled={!editForm.amount || saving} onClick={() => void saveEdit()}>{saving ? "Saving…" : "Save changes"}</button></div></section></div>}
  </>;
}

type OperatingCost = { id: string; name: string; category: string; amount: string; currency: string; cadence: string; allocation_basis: string; effective_from: string; effective_to: string | null; notes: string | null };
type PaymentFeeRule = { id: string; gateway: string; percentage_rate: string; fixed_fee: string; tax_rate: string; minimum_fee: string; currency: string; effective_from: string; effective_to: string | null };
function Expenses() {
  const [costs, setCosts] = useState<OperatingCost[]>([]);
  const [paymentRules, setPaymentRules] = useState<PaymentFeeRule[]>([]);
  const [currency, setCurrency] = useState("GBP");
  const [canEdit, setCanEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddPaymentRule, setShowAddPaymentRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", category: "software", amount: "", cadence: "monthly", allocationBasis: "fixed", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });
  const [paymentForm, setPaymentForm] = useState({ gateway: "", percentageRate: "0", fixedFee: "0", taxRate: "0", minimumFee: "0", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "" });
  const load = () => Promise.all([
    fetch("/api/costs/operating").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load operating costs"); return payload; }),
    fetch("/api/costs/payment-fees").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load payment fee rules"); return payload; }),
  ]).then(([costPayload, feePayload]) => {
    setError("");
    setCosts(costPayload.costs ?? []);
    setPaymentRules(feePayload.rules ?? []);
    setCurrency(costPayload.currency ?? feePayload.currency ?? "GBP");
    setCanEdit(Boolean(costPayload.canEdit && feePayload.canEdit));
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load expenses"));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/operating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, effectiveTo: form.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save operating cost");
      setShowAdd(false); setForm({ ...form, name: "", amount: "", effectiveTo: "", notes: "" }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save operating cost"); } finally { setSaving(false); }
  };
  const savePaymentRule = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/payment-fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...paymentForm, effectiveTo: paymentForm.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save payment fee rule");
      setShowAddPaymentRule(false);
      setPaymentForm({ ...paymentForm, gateway: "", percentageRate: "0", fixedFee: "0", taxRate: "0", minimumFee: "0", effectiveTo: "" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save payment fee rule"); } finally { setSaving(false); }
  };
  const deletePaymentRule = async (rule: PaymentFeeRule) => {
    if (!window.confirm(`Delete the ${rule.gateway} rule effective ${rule.effective_from}?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/costs/payment-fees?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete payment fee rule");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete payment fee rule"); }
  };
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
  return <>
    <section className="cost-toolbar">
      <div><span className="eyebrow">COST INPUTS</span><h2>Expenses and payment fees</h2><p>Use effective dates so the P&amp;L applies each cost and gateway rate to the right orders.</p></div>
      <div className="feature-actions"><button className="primary" disabled={!canEdit} onClick={() => setShowAdd(true)}><Plus/> Add expense</button><button disabled={!canEdit} onClick={() => setShowAddPaymentRule(true)}><Plus/> Add payment rule</button></div>
    </section>
    {error && <div className="connection-error cost-error">{error}</div>}
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">COST SCHEDULE</span><h2>Operating expenses</h2></div></div>
      {costs.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Category</th><th>Amount</th><th>Cadence</th><th>Allocation</th><th>Effective from</th><th>Effective to</th></tr></thead><tbody>{costs.map((cost) => <tr key={cost.id}><td><strong>{cost.name}</strong>{cost.notes && <small>{cost.notes}</small>}</td><td>{cost.category}</td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>{cost.cadence.replace("_", " ")}</td><td>{cost.allocation_basis}</td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><WalletCards/><strong>No operating costs yet</strong><span>Add a recurring or one-off cost to include it in future net-profit calculations.</span></div>}
    </section>
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">TRANSACTION COSTS</span><h2>Payment fee rules</h2><p>Rules fill gaps when Shopify does not provide an actual transaction fee.</p></div></div>
      {paymentRules.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Gateway</th><th>Rate</th><th>Fixed fee</th><th>Tax</th><th>Minimum</th><th>Effective from</th><th>Effective to</th><th></th></tr></thead><tbody>{paymentRules.map((rule) => <tr key={rule.id}><td><strong>{rule.gateway}</strong><small>{rule.currency}</small></td><td>{Number(rule.percentage_rate).toLocaleString("en-GB")}%</td><td>{formatter.format(Number(rule.fixed_fee))}</td><td>{Number(rule.tax_rate).toLocaleString("en-GB")}%</td><td>{formatter.format(Number(rule.minimum_fee))}</td><td>{rule.effective_from}</td><td>{rule.effective_to || "Ongoing"}</td><td>{canEdit && <button className="icon-button" aria-label={`Delete ${rule.gateway} payment fee rule`} onClick={() => void deletePaymentRule(rule)}><Trash2/></button>}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><CircleDollarSign/><strong>No payment fee rules yet</strong><span>Add a gateway rate to estimate fees when imported transactions do not include an actual fee.</span></div>}
    </section>
    {showAdd && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowAdd(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">OPERATING COST</span><h2>Add expense</h2></div></div><label className="form-field"><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Shopify subscription"/></label><div className="cost-form-grid"><label className="form-field"><span>Category</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{["software", "agency", "payroll", "warehouse", "rent", "creative", "fulfilment", "handling", "pick_pack", "duties", "other"].map((category) => <option key={category} value={category}>{category.replace("_", " ")}</option>)}</select></label><label className="form-field"><span>{form.allocationBasis === "revenue" ? "Revenue rate (%)" : "Amount"}</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder={form.allocationBasis === "revenue" ? "e.g. 2.5" : "0.00"}/></label><label className="form-field"><span>Cadence</span><select value={form.cadence} onChange={(event) => setForm({ ...form, cadence: event.target.value })}>{["one_off", "daily", "weekly", "monthly", "annual"].map((cadence) => <option key={cadence} value={cadence}>{cadence.replace("_", " ")}</option>)}</select></label><label className="form-field"><span>Allocation</span><select value={form.allocationBasis} onChange={(event) => setForm({ ...form, allocationBasis: event.target.value })}>{["fixed", "orders", "units", "revenue"].map((basis) => <option key={basis} value={basis}>{basis}</option>)}</select></label><label className="form-field"><span>Effective from</span><input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}/></label></div><label className="form-field"><span>Notes <small>Optional</small></span><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What this cost covers"/></label><p className="modal-intro">{form.allocationBasis === "fixed" ? "Fixed costs are spread across their active date range." : form.allocationBasis === "revenue" ? "Revenue allocation uses the entered percentage of net product sales during the active period." : `This uses the entered amount for every ${form.allocationBasis === "orders" ? "order" : "unit"} during the active period.`}</p><div className="modal-actions"><button onClick={() => setShowAdd(false)}>Cancel</button><button className="primary" disabled={!form.name || !form.amount || saving} onClick={save}>{saving ? "Saving…" : "Save expense"}</button></div></section></div>}
    {showAddPaymentRule && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowAddPaymentRule(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><CircleDollarSign/></span><div><span className="eyebrow">PAYMENT FEE</span><h2>Add gateway rule</h2></div></div><label className="form-field"><span>Shopify gateway name</span><input value={paymentForm.gateway} onChange={(event) => setPaymentForm({ ...paymentForm, gateway: event.target.value })} placeholder="e.g. shopify_payments"/></label><div className="cost-form-grid"><label className="form-field"><span>Percentage rate</span><input inputMode="decimal" value={paymentForm.percentageRate} onChange={(event) => setPaymentForm({ ...paymentForm, percentageRate: event.target.value })} placeholder="e.g. 1.8"/></label><label className="form-field"><span>Fixed fee ({currency})</span><input inputMode="decimal" value={paymentForm.fixedFee} onChange={(event) => setPaymentForm({ ...paymentForm, fixedFee: event.target.value })} placeholder="e.g. 0.30"/></label><label className="form-field"><span>Tax rate</span><input inputMode="decimal" value={paymentForm.taxRate} onChange={(event) => setPaymentForm({ ...paymentForm, taxRate: event.target.value })} placeholder="e.g. 20"/></label><label className="form-field"><span>Minimum fee ({currency})</span><input inputMode="decimal" value={paymentForm.minimumFee} onChange={(event) => setPaymentForm({ ...paymentForm, minimumFee: event.target.value })} placeholder="0.00"/></label><label className="form-field"><span>Effective from</span><input type="date" value={paymentForm.effectiveFrom} onChange={(event) => setPaymentForm({ ...paymentForm, effectiveFrom: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={paymentForm.effectiveTo} onChange={(event) => setPaymentForm({ ...paymentForm, effectiveTo: event.target.value })}/></label></div><p className="modal-intro">The fee is the greater of the percentage plus fixed fee and the minimum fee, with tax added afterward. Imported actual fees still take priority.</p><div className="modal-actions"><button onClick={() => setShowAddPaymentRule(false)}>Cancel</button><button className="primary" disabled={!paymentForm.gateway || saving} onClick={savePaymentRule}>{saving ? "Saving…" : "Save rule"}</button></div></section></div>}
  </>;
}

type LeadDashboardData = {
  currency: string;
  connection: { status: string; external_account_name: string | null } | null;
  config: { source_type: "contacts" | "opportunities"; metric_label: string; selection_name: string | null } | null;
  totals: { metaSpend: number; googleSpend: number; totalSpend: number; conversions: number; costPerConversion: number | null };
  points: Array<{ date: string; metaSpend: number; googleSpend: number; conversions: number }>;
};

function groupLeadPoints(points: LeadDashboardData["points"], granularity: ReportingGranularity) {
  if (granularity === "daily") return points;
  const grouped = new Map<string, LeadDashboardData["points"][number]>();
  for (const point of points) {
    const date = new Date(`${point.date}T00:00:00Z`);
    let key = point.date;
    if (granularity === "weekly") { const start = new Date(date); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); key = start.toISOString().slice(0, 10); }
    if (granularity === "monthly") key = `${point.date.slice(0, 7)}-01`;
    if (granularity === "quarterly") key = `${point.date.slice(0, 4)}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    if (granularity === "annual") key = point.date.slice(0, 4);
    const current = grouped.get(key) ?? { date: key, metaSpend: 0, googleSpend: 0, conversions: 0 };
    current.metaSpend += point.metaSpend; current.googleSpend += point.googleSpend; current.conversions += point.conversions; grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function LeadPerformanceChart({ points, currency, label }: { points: LeadDashboardData["points"]; currency: string; label: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 860, height = 300, left = 54, right = 64, top = 18, bottom = 42;
  const spend = points.map((point) => point.metaSpend + point.googleSpend);
  const maxSpend = Math.max(1, ...spend);
  const costPerEvent = points.map((point) => point.conversions > 0 ? (point.metaSpend + point.googleSpend) / point.conversions : null);
  const maxCost = Math.max(1, ...costPerEvent.filter((value): value is number => value !== null));
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const pointWidth = chartWidth / Math.max(points.length, 1);
  const x = (index: number) => left + pointWidth * (index + .5);
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const costY = (value: number) => top + chartHeight - (value / maxCost) * chartHeight;
  const format = new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 });
  const selected = hovered === null ? null : points[hovered];
  const costSegments: string[] = [];
  let segment: string[] = [];
  costPerEvent.forEach((value, index) => {
    if (value === null) {
      if (segment.length) costSegments.push(segment.join(" "));
      segment = [];
    } else segment.push(`${x(index)},${costY(value)}`);
  });
  if (segment.length) costSegments.push(segment.join(" "));
  const ticks = [0, .25, .5, .75, 1];
  return <div className="lead-chart-wrap">
    <div className="lead-chart-legend"><span><i className="lead-key meta"/>Meta spend</span><span><i className="lead-key google"/>Google spend</span><span><i className="lead-key result"/>Cost per {label.toLowerCase()}</span></div>
    <div className="lead-chart" role="img" aria-label={`Marketing spend and cost per selected ${label}s across the selected reporting period`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {ticks.map((tick) => { const y = top + chartHeight - tick * chartHeight; return <g key={tick}><line className="lead-gridline" x1={left} x2={width-right} y1={y} y2={y}/><text className="lead-axis-label" x={left-10} y={y+4} textAnchor="end">{format.format(maxSpend*tick)}</text><text className="lead-axis-label" x={width-right+10} y={y+4}>{format.format(maxCost*tick)}</text></g>; })}
        <line className="lead-axis" x1={left} x2={width-right} y1={top+chartHeight} y2={top+chartHeight}/>
        {points.map((point, index) => { const barWidth = Math.max(1, Math.min(34, pointWidth * .64)); const googleH = (point.googleSpend/maxSpend)*chartHeight; const metaH = (point.metaSpend/maxSpend)*chartHeight; const base = top+chartHeight; return <g key={point.date} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} className="lead-chart-point"><rect className="lead-hover-target" x={x(index)-pointWidth/2} y={top} width={pointWidth} height={chartHeight}/><rect className="lead-google-bar" x={x(index)-barWidth/2} y={base-googleH} width={barWidth} height={googleH}/><rect className="lead-meta-bar" x={x(index)-barWidth/2} y={base-googleH-metaH} width={barWidth} height={metaH}/><text className="lead-x-label" x={x(index)} y={height-14} textAnchor="middle">{(index % labelEvery === 0 || index === points.length - 1) ? point.date.slice(5) : ""}</text>{hovered === index && costPerEvent[index] !== null && <circle className="lead-result-dot active" cx={x(index)} cy={costY(costPerEvent[index]!)} r="5"/>}</g>; })}
        {costSegments.map((segmentPoints, index) => <polyline key={index} className="lead-results-line" points={segmentPoints}/>)}
        {costPerEvent.map((value, index) => value === null ? null : <circle key={`dot-${points[index].date}`} className="lead-result-dot" cx={x(index)} cy={costY(value)} r="3"/>)}
        <text className="lead-axis-title" x={left} y={12}>Spend</text><text className="lead-axis-title" x={width-right} y={12} textAnchor="end">Cost / event</text>
      </svg>
      {selected && <div className="lead-tooltip" style={{ left: `${Math.max(12, Math.min(88, ((x(hovered!) - left) / chartWidth) * 100))}%` }}><strong>{selected.date}</strong><span>Meta: {format.format(selected.metaSpend)}</span><span>Google: {format.format(selected.googleSpend)}</span><span>Spend: {format.format(selected.metaSpend+selected.googleSpend)}</span><b>{selected.conversions.toLocaleString("en-GB")} {label}{selected.conversions === 1 ? "" : "s"}</b><b>Cost per event: {costPerEvent[hovered!] === null ? "—" : format.format(costPerEvent[hovered!]!)}</b></div>}
    </div>
  </div>;
}

function Leads({ onOpenConnections, range, onRangeChange }: { onOpenConnections: () => void; range: { from: string; to: string; label: string; preset: FinanceDatePreset }; onRangeChange: (next: Partial<{ preset: FinanceDatePreset; from: string; to: string }>) => void }) {
  const [data, setData] = useState<LeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choosingStage, setChoosingStage] = useState(false);
  const [syncingOpportunities, setSyncingOpportunities] = useState(false);
  const [stagePicker, setStagePicker] = useState<Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position?: number }> }> | null>(null);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [includeLaterStages, setIncludeLaterStages] = useState(true);
  const [granularity, setGranularity] = useState<ReportingGranularity>("daily");
  const load = useCallback(async (force = false) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams(); if (range.from) params.set("from", range.from); if (range.to) params.set("to", range.to);
      const url = `/api/analytics/leads${params.size ? `?${params}` : ""}`;
      const payload = await fetchCachedJson<LeadDashboardData>(url, { force });
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load lead performance"); }
    finally { setLoading(false); }
  }, [range.from, range.to]);
  useEffect(() => { void load(); }, [load]);
  const syncOpportunities = async () => {
    setSyncingOpportunities(true); setError("");
    try {
      const response = await fetch("/api/connections/gohighlevel/sync", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not sync GoHighLevel opportunities");
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sync GoHighLevel opportunities");
    } finally {
      setSyncingOpportunities(false);
    }
  };
  const choosePipelineStage = async () => {
    setChoosingStage(true); setError("");
    try { const response = await fetch("/api/connections/gohighlevel/pipelines"); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Could not load GoHighLevel pipelines"); setStagePicker(payload.pipelines ?? []); setSelectedStageIds([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load GoHighLevel pipelines"); } finally { setChoosingStage(false); }
  };
  const savePipelineStages = async () => {
    const selected = (stagePicker ?? []).flatMap((pipeline) => pipeline.stages.map((stage) => ({ pipeline, stage }))).filter(({ stage }) => selectedStageIds.includes(stage.id));
    if (!selected.length) { setError("Choose at least one pipeline stage"); return; }
    setChoosingStage(true); setError("");
    try { const response = await fetch("/api/connections/gohighlevel", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selections: selected.map(({ pipeline, stage }) => ({ pipelineId: pipeline.id, pipelineName: pipeline.name, stageId: stage.id, stageName: stage.name, position: stage.position ?? 0 })), includeLaterStages }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Could not save the selected stages"); setStagePicker(null); await syncOpportunities(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the selected stages"); } finally { setChoosingStage(false); }
  };
  const format = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const configLabel = data?.config?.metric_label || "conversion";
  const groupedPoints = groupLeadPoints(data?.points ?? [], granularity);
  const chartPoints = groupedPoints;
  const bestPoint = chartPoints.reduce<LeadDashboardData["points"][number] | null>((best, point) => !best || point.conversions > best.conversions ? point : best, null);
  return <section className="leads-dashboard">
    <div className="lead-dashboard-heading"><div><span className="eyebrow">LEAD GENERATION</span><h2>Lead performance</h2><p>Marketing cost against the GoHighLevel result selected for this account. Reporting period: {range.label}.</p></div><button className="filter-button" onClick={() => data?.config?.source_type === "opportunities" ? void syncOpportunities() : void load()} disabled={loading || syncingOpportunities}><RefreshCw className={loading || syncingOpportunities ? "spin" : ""}/>{syncingOpportunities ? "Syncing opportunities…" : loading ? "Refreshing" : "Refresh"}</button></div>\n    <section className="filter-row pnl-period finance-date-controls lead-date-controls"><label>Period<select aria-label="Lead reporting period" value={range.preset} onChange={(event) => onRangeChange({ preset: event.target.value as FinanceDatePreset })}><option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option></select></label><label>From<input type="date" value={range.from} onChange={(event) => onRangeChange({ preset: "custom", from: event.target.value })}/></label><label>To<input type="date" value={range.to} onChange={(event) => onRangeChange({ preset: "custom", to: event.target.value })}/></label><label>Group by<select aria-label="Lead trend granularity" value={granularity} onChange={(event) => setGranularity(event.target.value as ReportingGranularity)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label></section>
    {error ? <div className="connection-error" role="alert">{error}</div> : null}
    {!loading && !data?.connection ? <div className="connection-notice"><Info/><div><strong>Connect GoHighLevel to start lead reporting</strong><span>Choose contacts or pipeline opportunities, then Spine can calculate cost per result.</span></div><button className="primary" onClick={onOpenConnections}>Open Connections</button></div> : null}
    <div className="metric-grid">
      <article className="metric-card"><div className="metric-label">Meta cost</div><strong>{format.format(data?.totals.metaSpend ?? 0)}</strong><div className="metric-foot">Imported Meta Ads spend</div></article>
      <article className="metric-card"><div className="metric-label">Google cost</div><strong>{format.format(data?.totals.googleSpend ?? 0)}</strong><div className="metric-foot">Imported Google Ads spend</div></article>
      <article className="metric-card"><div className="metric-label">Total marketing cost</div><strong>{format.format(data?.totals.totalSpend ?? 0)}</strong><div className="metric-foot">Meta + Google</div></article>
      <article className="metric-card"><div className="metric-label">Cost per event</div><strong>{data?.totals.costPerConversion === null || data?.totals.costPerConversion === undefined ? "—" : format.format(data.totals.costPerConversion)}</strong><div className="metric-foot">{data?.totals.conversions ?? 0} {configLabel}{(data?.totals.conversions ?? 0) === 1 ? "" : "s"} imported</div></article>
    </div>
    <section className="panel lead-trend-panel"><div className="panel-head"><div><span className="eyebrow">TREND</span><h3>Spend and selected-stage events</h3><p className="lead-chart-description">Paid-media spend on the left axis and cost per selected GoHighLevel event on the right. Choose day, week or month grouping above.</p></div><div className="lead-selection"><span>{data?.config?.selection_name || data?.connection?.external_account_name || "GoHighLevel"}</span>{data?.connection && <button className="filter-button" onClick={() => void choosePipelineStage()} disabled={choosingStage}>{choosingStage ? "Loading…" : "Choose pipeline stage"}</button>}</div></div>{loading ? <div className="cost-empty"><RefreshCw className="spin"/><strong>Loading lead performance…</strong></div> : chartPoints.length ? <LeadPerformanceChart points={chartPoints} currency={data?.currency || "GBP"} label={configLabel} /> : <div className="cost-empty"><BarChart3/><strong>No reporting data has been imported yet</strong><span>Your GoHighLevel connection is saved. Choose a pipeline stage above, then refresh to import its opportunity events.</span></div>}</section>
    {!loading && chartPoints.length ? <section className="panel lead-event-table"><div className="panel-head"><div><span className="eyebrow">SELECTED STAGE</span><h3>{configLabel} events and cost</h3><p>Current opportunities in the selected stage, plus later stages if enabled, grouped by GoHighLevel’s last stage-change date. Records without that date use their created date.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Period</th><th>Meta spend</th><th>Google spend</th><th>Total spend</th><th>Selected-stage events</th><th>Cost per event</th></tr></thead><tbody>{chartPoints.map((point) => { const spend = point.metaSpend + point.googleSpend; return <tr key={point.date}><td>{point.date}</td><td>{format.format(point.metaSpend)}</td><td>{format.format(point.googleSpend)}</td><td><strong>{format.format(spend)}</strong></td><td>{point.conversions.toLocaleString("en-GB")}</td><td>{point.conversions ? format.format(spend / point.conversions) : "—"}</td></tr>; })}</tbody></table></div></section> : null}
    {!loading && chartPoints.length ? <section className="lead-insights-grid">
      <article className="panel lead-insight"><span className="eyebrow">CHANNEL MIX</span><h3>Paid media spend</h3><div className="lead-split"><span style={{width: `${Math.max(4, ((data?.totals.metaSpend ?? 0) / Math.max(1, data?.totals.totalSpend ?? 0))*100)}%`}}/><i style={{width: `${Math.max(0, ((data?.totals.googleSpend ?? 0) / Math.max(1, data?.totals.totalSpend ?? 0))*100)}%`}}/></div><div className="lead-insight-values"><span>Meta <b>{format.format(data?.totals.metaSpend ?? 0)}</b></span><span>Google <b>{format.format(data?.totals.googleSpend ?? 0)}</b></span></div></article>
      <article className="panel lead-insight"><span className="eyebrow">EFFICIENCY</span><h3>Cost per result</h3><strong>{data?.totals.costPerConversion == null ? "—" : format.format(data.totals.costPerConversion)}</strong><p>{data?.totals.conversions ?? 0} selected {configLabel}{(data?.totals.conversions ?? 0) === 1 ? "" : "s"} across the current reporting window.</p></article>
      <article className="panel lead-insight"><span className="eyebrow">DAILY SIGNAL</span><h3>Best result day</h3><strong>{bestPoint?.date || "—"}</strong><p>{bestPoint ? `${bestPoint.conversions} ${configLabel}${bestPoint.conversions === 1 ? "" : "s"} recorded.` : "No selected-stage results recorded."}</p></article>
    </section> : null}
    {stagePicker && <div className="modal-backdrop" onMouseDown={() => setStagePicker(null)}><section className="connection-modal lead-stage-picker" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setStagePicker(null)}><X/></button><span className="eyebrow">GOHIGHLEVEL</span><h2>Choose conversion stages</h2><p className="modal-intro">Select one or more stages. Include opportunities that have progressed beyond the selected stage.</p><div className="stage-options">{stagePicker.map((pipeline) => <div key={pipeline.id}><strong>{pipeline.name}</strong>{pipeline.stages.map((stage) => <label key={stage.id} className="stage-option"><input type="checkbox" checked={selectedStageIds.includes(stage.id)} onChange={() => setSelectedStageIds((ids) => ids.includes(stage.id) ? ids.filter((id) => id !== stage.id) : [...ids, stage.id])}/><span>{stage.name}</span></label>)}</div>)}</div><label className="stage-option include-later"><input type="checkbox" checked={includeLaterStages} onChange={(event) => setIncludeLaterStages(event.target.checked)}/><span>Include opportunities that progressed beyond selected stages</span></label><div className="modal-actions"><button onClick={() => setStagePicker(null)}>Cancel</button><button className="primary" disabled={choosingStage || !selectedStageIds.length} onClick={() => void savePipelineStages()}>{choosingStage ? "Saving…" : "Save stages"}</button></div></section></div>}
  </section>;
}

function Connections() {
  const [showMetaSetup, setShowMetaSetup] = useState(false);
  const [showShopifySetup, setShowShopifySetup] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [metaAccounts, setMetaAccounts] = useState<Array<{ id: string; name: string; currency: string | null; accountStatus: number | null }>>([]);
  const [loadingMetaAccounts, setLoadingMetaAccounts] = useState(false);
  const [metaLookbackMonths, setMetaLookbackMonths] = useState("12");
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaConnectionStatus, setMetaConnectionStatus] = useState<"connected" | "error" | "disconnected">("disconnected");
  const [metaConnectionError, setMetaConnectionError] = useState("");
  const [googleAdsConnected, setGoogleAdsConnected] = useState(false);
  const [googleAdsAccountName, setGoogleAdsAccountName] = useState("");
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<Array<{ customer_id: string; name: string; is_manager: boolean; hierarchy_level: number; direct_access: boolean }>>([]);
  const [showGoogleAdsAccounts, setShowGoogleAdsAccounts] = useState(false);
  const [selectingGoogleAdsAccount, setSelectingGoogleAdsAccount] = useState(false);
  const [klaviyoConnected, setKlaviyoConnected] = useState(false);
  const [ghlConnected, setGhlConnected] = useState(false);
  const [ghlAccountName, setGhlAccountName] = useState("");
  const [metaAccountName, setMetaAccountName] = useState("");
  const [metaSyncResult, setMetaSyncResult] = useState("");
  const [metaLastSync, setMetaLastSync] = useState<{ importedDays: number; latestDate: string | null; syncedAt: string | null } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [savingConnection, setSavingConnection] = useState(false);
  const [shopDomain, setShopDomain] = useState("");
  const [shopifyToken, setShopifyToken] = useState("");
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyName, setShopifyName] = useState("");
  const [shopifyScopes, setShopifyScopes] = useState<string[]>([]);
  const [shopifyStore, setShopifyStore] = useState<{ shopify_domain: string | null; currency: string; reporting_currency: string; timezone: string | null } | null>(null);
  const [shopifySyncResult, setShopifySyncResult] = useState("");
  const [shopifyLastSync, setShopifyLastSync] = useState<{ status: string; sync_mode: "initial" | "incremental"; window_start: string | null; window_end: string | null; pages_processed: number; records_processed: number; warnings: unknown[]; error_message: string | null; completed_at: string | null; updated_at: string } | null>(null);
  const [clock, setClock] = useState(0);
  const shopifyImportPaused = shopifyLastSync?.status === "running" && Date.parse(shopifyLastSync.updated_at) < clock - 6 * 60 * 1000;
  useEffect(() => {
    const refreshClock = () => setClock(Date.now());
    const initial = window.setTimeout(refreshClock, 0);
    const interval = window.setInterval(refreshClock, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    fetch("/api/connections/meta")
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.connection) return;
        setMetaConnected(payload.connection.status === "connected");
        setMetaConnectionStatus(payload.connection.status === "connected" ? "connected" : payload.connection.status === "error" ? "error" : "disconnected");
        setMetaConnectionError(payload.connection.last_error ?? "");
        if (payload.connection.status === "error" && payload.connection.last_error) setConnectionError(payload.connection.last_error);
        setAccountId(payload.connection.external_account_id ?? "");
        setMetaAccountName(payload.connection.external_account_name ?? "");
        setMetaLastSync(payload.sync ?? null);
      })
      .catch(() => undefined);
    fetch("/api/connections/google-ads").then((response) => response.ok ? response.json() : null).then((payload) => { setGoogleAdsConnected(payload?.connection?.status === "connected"); setGoogleAdsAccountName(payload?.connection?.external_account_name ?? ""); }).catch(() => undefined);
    fetch("/api/connections/google-ads/accounts").then((response) => response.ok ? response.json() : null).then((payload) => setGoogleAdsAccounts(payload?.accounts ?? [])).catch(() => undefined);
    const googleAdsQuery = new URLSearchParams(window.location.search);
    if (googleAdsQuery.get("googleAds") === "select") {
      const discoveryError = googleAdsQuery.get("googleAdsError");
      const timeout = window.setTimeout(() => {
        setShowGoogleAdsAccounts(true);
        if (discoveryError) setConnectionError(discoveryError);
        window.history.replaceState({}, "", "/protected");
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    fetch("/api/connections/klaviyo").then((response) => response.ok ? response.json() : null).then((payload) => setKlaviyoConnected(payload?.connection?.status === "connected")).catch(() => undefined);
    fetch("/api/connections/gohighlevel").then((response) => response.ok ? response.json() : null).then((payload) => { setGhlConnected(payload?.connection?.status === "connected"); setGhlAccountName(payload?.connection?.external_account_name ?? ""); }).catch(() => undefined);
    fetch("/api/connections/shopify")
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.connection) return;
        setShopifyConnected(payload.connection.status === "connected");
        setShopifyName(payload.connection.external_account_name ?? "");
        setShopifyScopes(payload.connection.granted_scopes ?? []);
        setShopifyStore(payload.store ?? null);
        setShopifyLastSync(payload.sync ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const status = query.get("metaOAuth");
    if (!status) return;
    const message = status === "connected" ? query.get("metaAccount") : query.get("metaError");
    const timeout = window.setTimeout(() => {
      setShowMetaSetup(true);
      if (status === "connected") setMetaSyncResult(`Connected through Facebook${message ? ` to ${message}` : ""}. Your selected spend history has been imported.`);
      else setConnectionError(message || "Facebook could not be connected.");
      window.history.replaceState({}, "", "/protected");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const connectMetaWithFacebook = () => {
    setConnectionError("");
    const params = new URLSearchParams({ lookbackMonths: metaLookbackMonths });
    window.location.assign(`/api/connections/meta/authorize?${params}`);
  };

  const loadMetaAccounts = async () => {
    if (!token.trim()) return;
    setLoadingMetaAccounts(true);
    setConnectionError("");
    setMetaAccounts([]);
    setAccountId("");
    try {
      const response = await fetch("/api/connections/meta/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setConnectionError(payload.error ?? "Could not load Meta ad accounts");
        return;
      }
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      setMetaAccounts(accounts);
      if (accounts.length === 1) setAccountId(accounts[0].id);
      if (accounts.length === 0) setConnectionError("No ad accounts were found for this token.");
    } catch {
      setConnectionError("Could not reach Meta to load ad accounts. Try again.");
    } finally {
      setLoadingMetaAccounts(false);
    }
  };

  const saveMeta = async () => {
    if (!token.trim() || !accountId) return;
    setSavingConnection(true);
    setConnectionError("");
    const response = await fetch("/api/connections/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token.trim(), accountId: accountId.trim(), lookbackMonths: Number(metaLookbackMonths) }),
    });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) {
      setConnectionError(payload.error ?? "Could not connect Meta Ads");
      return;
    }
    setMetaConnected(true);
    setMetaConnectionStatus("connected");
    setMetaConnectionError("");
    setMetaAccountName(payload.connection?.external_account_name ?? "");
    setAccountId(payload.connection?.external_account_id ?? accountId);
    setMetaSyncResult(`${payload.sync?.importedDays ?? 0} daily Meta spend records imported (${payload.sync?.range?.since ?? "selected"} to ${payload.sync?.range?.until ?? "today"})`);
    setToken("");
  };

  const disconnectMeta = async () => {
    setSavingConnection(true);
    const response = await fetch("/api/connections/meta", { method: "DELETE" });
    setSavingConnection(false);
    if (!response.ok) {
      const payload = await response.json();
      setConnectionError(payload.error ?? "Could not disconnect Meta Ads");
      return;
    }
    setToken(""); setAccountId(""); setMetaAccountName(""); setMetaSyncResult(""); setMetaLastSync(null); setMetaConnected(false); setMetaConnectionStatus("disconnected"); setMetaConnectionError(""); setShowMetaSetup(false);
  };

  const disconnectShopify = async () => {
    setSavingConnection(true); setConnectionError("");
    const response = await fetch("/api/connections/shopify", { method: "DELETE" });
    setSavingConnection(false);
    if (!response.ok) { const payload = await response.json(); setConnectionError(payload.error ?? "Could not disconnect Shopify"); return; }
    setShopifyConnected(false); setShopifyName(""); setShopifyScopes([]); setShopifyStore(null); setShopifyToken(""); setShopifySyncResult(""); setShopifyLastSync(null); setShowShopifySetup(false);
  };

  const saveShopify = async () => {
    if (!shopifyConnected && (!shopDomain.trim() || !shopifyToken.trim())) return;
    setSavingConnection(true); setConnectionError(""); setShopifySyncResult("");
    const response = await fetch("/api/connections/shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shopifyToken.trim() ? { shopDomain, accessToken: shopifyToken } : {}) });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) { setConnectionError(payload.error ?? "Could not connect Shopify"); return; }
    setShopifyConnected(true); setShopifyName(payload.connection?.external_account_name ?? shopDomain); setShopifyScopes(payload.connection?.granted_scopes ?? []); setShopifyToken("");
    setShopifySyncResult(`${payload.sync?.mode === "incremental" ? "Incremental refresh" : "Historical import"}: ${payload.sync?.products ?? 0} products, ${payload.sync?.variants ?? 0} variants, ${payload.sync?.orders ?? 0} orders and ${payload.sync?.customers ?? 0} customers imported`);
    window.setTimeout(() => window.location.reload(), 750);
  };

  const connectKlaviyo = async () => { const apiKey = window.prompt("Paste your Klaviyo private API key"); if (!apiKey) return; setSavingConnection(true); const response = await fetch("/api/connections/klaviyo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) }); setSavingConnection(false); if (!response.ok) { const payload = await response.json(); setConnectionError(payload.error || "Could not connect Klaviyo"); return; } setKlaviyoConnected(true); };
  const connectGhl = async () => {
    const apiKey = window.prompt("Paste the GoHighLevel private integration token"); if (!apiKey) return;
    const locationId = window.prompt("Paste the GoHighLevel sub-account location ID"); if (!locationId) return;
    const sourceType = window.confirm("Use pipeline opportunities? Choose Cancel for contacts or a smart list.") ? "opportunities" : "contacts";
    const metricLabel = window.prompt("What should this cost be measured per?", sourceType === "opportunities" ? "Booked calls" : "Qualified leads"); if (!metricLabel) return;
    setSavingConnection(true); setConnectionError("");
    try {
      const response = await fetch("/api/connections/gohighlevel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, locationId, sourceType, metricLabel }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setConnectionError(payload.error || "GoHighLevel could not validate those details. Use a Private Integration token and the ID of the sub-account it belongs to."); return; }
      setGhlConnected(true);
      setGhlAccountName(payload.connection?.external_account_name ?? locationId);
    } catch {
      setConnectionError("GoHighLevel could not be reached. Please try again in a moment.");
    } finally { setSavingConnection(false); }
  };
  const connectGoogleAds = () => { window.location.assign("/api/google-ads/authorize"); };
  const selectGoogleAdsAccount = async (customerId: string) => {
    setSelectingGoogleAdsAccount(true); setConnectionError("");
    try {
      const response = await fetch("/api/connections/google-ads/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not select Google Ads account");
      setGoogleAdsAccountName(payload.connection?.external_account_name ?? "");
      setGoogleAdsConnected(true); setShowGoogleAdsAccounts(false);
    } catch (reason) { setConnectionError(reason instanceof Error ? reason.message : "Could not select Google Ads account"); } finally { setSelectingGoogleAdsAccount(false); }
  };
  const connections = [
    ["Shopify", "Sales, orders, products & customers", shopifyConnected ? "Connected" : "Connect", "S"],
    ["Meta Ads", "Campaign spend & performance", metaConnectionStatus === "error" ? (/(expired|revoked)/i.test(metaConnectionError) ? "Expired" : "Needs attention") : metaConnected ? "Connected" : "Connect", "M"],
    ["Google Ads", googleAdsConnected ? (googleAdsAccountName || "Google Ads account") : "Campaign and keyword reporting", googleAdsConnected ? "Connected" : "Connect", "G"],
    ["Klaviyo", "Campaign and flow analytics", klaviyoConnected ? "Connected" : "Connect", "K"],
    ["GoHighLevel", ghlConnected ? (ghlAccountName || "GoHighLevel location") : "Lead, call and pipeline conversion reporting", ghlConnected ? "Connected" : "Connect", "H"],
  ];

  return <>
    <div className="connection-notice"><Info/><div><strong>Secure connection storage</strong><span>Access tokens are encrypted in Supabase Vault and are never returned to the browser after saving.</span></div></div>{connectionError && <div className="connection-error" role="alert">{connectionError}</div>}
    <section className="connection-grid">{connections.map(([name,desc,status,letter])=><article className="connection-card" key={name}><div className={`source-logo ${letter.toLowerCase()}`}>{letter}</div><div><h3>{name}</h3><p>{desc}</p></div><button disabled={status === "Coming next"} onClick={() => { if (name === "Meta Ads") setShowMetaSetup(true); else if (name === "Shopify") setShowShopifySetup(true); else if (name === "Google Ads") { if (googleAdsConnected) setShowGoogleAdsAccounts(true); else connectGoogleAds(); } else if (name === "Klaviyo") void connectKlaviyo(); else if (name === "GoHighLevel") void connectGhl(); }} className={status==="Connected" ? "connected" : status === "Expired" || status === "Needs attention" ? "expired" : ""}>{(status==="Connected" || status === "Expired" || status === "Needs attention")&&<span/>}{status}</button></article>)}</section>
    {showGoogleAdsAccounts && <div className="modal-backdrop" onMouseDown={() => setShowGoogleAdsAccounts(false)}><section className="connection-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowGoogleAdsAccounts(false)}><X/></button><div className="modal-brand"><div className="source-logo g">G</div><div><span className="eyebrow">GOOGLE ADS</span><h2>Choose an ad account</h2></div></div><p className="modal-intro">Select the Google Ads account for this brand. Manager accounts and their enabled client accounts are listed separately.</p>{connectionError && <div className="connection-error">{connectionError}</div>}{googleAdsAccounts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Customer ID</th><th>Type</th><th/></tr></thead><tbody>{googleAdsAccounts.map((account) => <tr key={account.customer_id}><td><strong>{account.name}</strong>{account.direct_access && <small>Direct Google access</small>}</td><td>{account.customer_id}</td><td>{account.is_manager ? "Manager (MCC)" : "Client account"}</td><td><button className="primary" disabled={selectingGoogleAdsAccount} onClick={() => void selectGoogleAdsAccount(account.customer_id)}>{googleAdsAccountName === account.name ? "Selected" : "Use this account"}</button></td></tr>)}</tbody></table></div> : <div className="cost-empty"><Database/><strong>No Google Ads accounts have been loaded yet</strong><span>Reconnect Google Ads to load the MCC hierarchy.</span></div>}<div className="modal-actions"><button onClick={() => setShowGoogleAdsAccounts(false)}>Close</button><button className="primary" onClick={connectGoogleAds}>Reconnect and refresh accounts</button></div></section></div>}
    {showShopifySetup && <div className="modal-backdrop" onMouseDown={()=>setShowShopifySetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowShopifySetup(false)}><X/></button><div className="modal-brand"><div className="source-logo s">S</div><div><span className="eyebrow">PRIMARY SALES SOURCE</span><h2>Connect Shopify</h2></div></div>
      <p className="modal-intro">Connect an Admin API token to validate the store and import catalogue, order, customer, refund and attribution data. Disconnecting removes the encrypted token but preserves your imported reporting data.</p>
      {shopifyConnected && shopifyName && <div className="connected-account"><span/><div><small>CONNECTED STORE</small><strong>{shopifyName}</strong>{shopifyStore && <small>{shopifyStore.shopify_domain || "Shopify store"} · {shopifyStore.currency} · {shopifyStore.timezone || "Timezone unavailable"}</small>}{shopifyScopes.length > 0 && <small>Granted scopes: {shopifyScopes.join(", ")}</small>}</div></div>}{shopifyLastSync && <div className={shopifyLastSync.status === "failed" ? "connection-error" : "connected-account"}><span/>{shopifyLastSync.status === "failed" ? <div><small>LAST IMPORT FAILED</small><strong>{shopifyLastSync.error_message || "Open the token and try again"}</strong></div> : shopifyImportPaused ? <div><small>IMPORT PAUSED AT A SAVED CHECKPOINT</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records saved. Use Retry import to resume.</strong></div> : shopifyLastSync.status === "running" ? <div><small>IMPORT IN PROGRESS</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records saved so far.</strong></div> : <div><small>LAST IMPORT</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records · {shopifyLastSync.completed_at ? new Date(shopifyLastSync.completed_at).toLocaleString("en-GB") : shopifyLastSync.status}</strong></div>}</div>}
      <div className="help-card"><Info/><div><strong>Required access scopes</strong><ol><li>Open your app in Shopify Dev Dashboard.</li><li>Grant <code>read_products</code>, <code>read_inventory</code>, <code>read_orders</code>, <code>read_customers</code> and <code>read_reports</code>.</li><li>Enable Level 2 protected customer data access for ShopifyQL reports.</li><li>Install or reinstall the app on the store and copy its Admin API token.</li></ol><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">Open Shopify Dev Dashboard <ExternalLink/></a></div></div>
      {shopifyLastSync && <div className="connection-notice"><Info/><div><strong>{shopifyLastSync.sync_mode === "incremental" ? "Rolling incremental refresh" : "Initial historical import"}</strong><span>{shopifyLastSync.pages_processed.toLocaleString()} order pages checkpointed{shopifyLastSync.window_start ? ` · refreshing changes since ${new Date(shopifyLastSync.window_start).toLocaleString("en-GB")}` : " · importing all available history"}</span></div></div>}
      <label className="form-field"><span>Store domain</span><input value={shopDomain} onChange={(event)=>setShopDomain(event.target.value)} placeholder="your-store.myshopify.com"/></label>
      <label className="form-field"><span>Admin API access token <b className="tooltip-trigger">?<em>Use an Admin API token with product, inventory, order and customer read scopes.</em></b></span><div className="secret-input"><KeyRound/><input value={shopifyToken} onChange={(event)=>setShopifyToken(event.target.value)} type={showToken?"text":"password"} placeholder="shpat_..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      {shopifySyncResult && <div className="connected-account"><span/><div><small>CATALOGUE SYNC COMPLETE</small><strong>{shopifySyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{shopifyConnected && <button className="danger-button" disabled={savingConnection} onClick={disconnectShopify}>Disconnect</button>}<button onClick={()=>setShowShopifySetup(false)}>Close</button><button className="primary" disabled={savingConnection || (!shopifyConnected && (!shopDomain.trim() || !shopifyToken.trim()))} onClick={saveShopify}>{savingConnection?"Importing Shopify orders…":shopifyConnected?(shopifyToken.trim()?"Reconnect & sync":"Retry order import"):"Connect & import"}</button></div>
    </section></div>}
    {showMetaSetup && <div className="modal-backdrop" onMouseDown={()=>setShowMetaSetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowMetaSetup(false)}><X/></button>
      <div className="modal-brand"><div className="source-logo m">M</div><div><span className="eyebrow">DATA CONNECTION</span><h2>Connect Meta Ads</h2></div></div>
      <p className="modal-intro">Connect with Facebook to grant Spine read-only access to your Meta Ads account. There is no Graph API Explorer token to copy and your Facebook password never reaches Spine.</p>
      <div className="connection-notice meta-oauth-notice"><Info/><div><strong>Connect your own Facebook account</strong><span>Choose the Meta ad account you manage, then Spine securely saves the approved connection and imports its daily spend.</span></div><button className="primary" disabled={savingConnection} onClick={connectMetaWithFacebook}><ExternalLink/>{metaConnectionStatus === "error" ? "Reconnect Facebook" : "Connect Facebook"}</button></div>
      {metaConnectionStatus === "error" && metaConnectionError && <div className="connection-error" role="alert">{metaConnectionError}</div>}
      {metaConnected && metaAccountName && <div className="connected-account"><span/><div><small>CURRENT ACCOUNT</small><strong>{metaAccountName}</strong>{metaLastSync ? <small>{metaLastSync.importedDays.toLocaleString()} daily spend records · latest {metaLastSync.latestDate ? new Date(`${metaLastSync.latestDate}T00:00:00Z`).toLocaleDateString("en-GB") : "date unavailable"}</small> : <small>Spend data has not been imported yet.</small>}</div></div>}
      <div className="help-card"><Info/><div><strong>Alternative for agency-managed accounts</strong><p>Use a Meta system-user token only if your business manages the connection centrally. For normal use, choose <b>Connect Facebook</b> above.</p><a className="meta-developer-link" href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer"><ExternalLink/>Open Graph API Explorer</a></div></div>
      <label className="form-field"><span>System-user token <small>Optional alternative</small><b className="tooltip-trigger">?<em>Use this only for a centrally managed Meta system user with ads_read and read_insights.</em></b></span><div className="secret-input"><KeyRound/><input value={token} onChange={(event)=>{setToken(event.target.value);setMetaAccounts([]);setAccountId("");setConnectionError("");}} type={showToken?"text":"password"} placeholder="EAAB..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      <div className="meta-account-discovery"><button type="button" disabled={!token.trim() || loadingMetaAccounts} onClick={() => void loadMetaAccounts()}>{loadingMetaAccounts ? "Loading accounts…" : metaAccounts.length ? "Reload ad accounts" : "Find ad accounts"}</button><small>{metaAccounts.length ? `${metaAccounts.length} account${metaAccounts.length === 1 ? "" : "s"} available to this token.` : "Enter your token, then load the ad accounts it can access."}</small></div>
      <label className="form-field"><span>Meta ad account</span><select value={accountId} onChange={(event)=>setAccountId(event.target.value)} disabled={!metaAccounts.length}><option value="">{metaAccounts.length ? "Choose an ad account" : "Load accounts to choose"}</option>{metaAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.currency ? ` · ${account.currency}` : ""} ({account.id.startsWith("act_") ? account.id : `act_${account.id}`})</option>)}</select></label>
      <label className="form-field"><span>Spend history to import</span><select value={metaLookbackMonths} onChange={(event)=>setMetaLookbackMonths(event.target.value)}><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="24">Last 24 months</option><option value="36">Last 36 months</option></select><small>New connections default to the last 365 days. Meta supports up to 37 months when you need more history.</small></label>
      <div className="permission-note"><KeyRound/><span><strong>Required permissions:</strong> ads_read, read_insights</span></div>
      {metaSyncResult && <div className="connected-account"><span/><div><small>SPEND IMPORT COMPLETE</small><strong>{metaSyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{metaConnected&&<button className="danger-button" disabled={savingConnection} onClick={disconnectMeta}>Disconnect</button>}<button onClick={()=>setShowMetaSetup(false)}>Cancel</button><button className="primary" disabled={!token.trim() || !accountId || savingConnection} onClick={saveMeta}>{savingConnection?"Importing…":metaConnected?"Save manual token":"Save manual token"}</button></div>
    </section></div>}
  </>;
}

type SalesOrder = { id: string; order_name: string; processed_at: string | null; financial_status: string | null; fulfillment_status: string | null; source_name: string | null; net_product_sales: string; shipping_revenue: string; total_sales: string; currency: string; refunded: number };
type SalesBreakdownDimension = "date" | "channel" | "customerType" | "country" | "discountCode" | "product";
type SalesBreakdownRow = { label: string; orders: number; units: number; sales: number; refunds?: number; cogs?: number; paymentFees?: number; grossProfit?: number; salesWithoutRecordedCost?: number; missingCostLines?: number };
type SalesData = { hasData: boolean; currency: string; timezone: string; period: { start: string; end: string } | null; analysisOrderCount: number; dailySource: "shopifyql" | "imported_orders"; breakdowns: Record<SalesBreakdownDimension, SalesBreakdownRow[]>; orders: SalesOrder[] };
type OrderDetail = { currency: string; order: SalesOrder & { gross_sales: string; discounts: string; tax: string; duties: string }; lines: Array<{ id: string; title: string; variant_title: string | null; sku: string | null; current_quantity: number; net_sales: string; unitCost: number | null; cogs: number | null }>; metrics: { refunds: number; cogs: number; grossProfit: number; missingCostLines: number } };

function Sales({ reportRunId }: { reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<SalesData | null>(null);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(default365DayRange.from);
  const [toDate, setToDate] = useState(default365DayRange.to);
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>("last_365_days");
  const [breakdownDimension, setBreakdownDimension] = useState<SalesBreakdownDimension>("date");
  const [groupBy, setGroupBy] = useState<ReportingGranularity>("daily");
  const [financialStatus, setFinancialStatus] = useState("all");
  const [fulfilmentStatus, setFulfilmentStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [refundFilter, setRefundFilter] = useState("all");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`/api/analytics/orders${params.size ? `?${params}` : ""}`).then(async (response) => response.ok ? response.json() as Promise<SalesData> : null).then((payload) => { setData(payload); finishReportRun(payload ? "completed" : "failed", payload?.analysisOrderCount ?? null); }).catch(() => { setData(null); finishReportRun("failed", null, "Sales data could not be loaded"); });
  }, [fromDate, toDate, finishReportRun]);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: detail?.currency || data?.currency || "GBP", maximumFractionDigits: 2 });
  const orders = data?.orders ?? [];
  const financialStatuses = [...new Set(orders.map((order) => order.financial_status || "Unknown"))].sort();
  const fulfilmentStatuses = [...new Set(orders.map((order) => order.fulfillment_status || "Unknown"))].sort();
  const sources = [...new Set(orders.map((order) => order.source_name || "Unknown"))].sort();
  const visibleOrders = orders.filter((order) => `${order.order_name} ${order.financial_status ?? ""} ${order.fulfillment_status ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (financialStatus === "all" || (order.financial_status || "Unknown") === financialStatus) && (fulfilmentStatus === "all" || (order.fulfillment_status || "Unknown") === fulfilmentStatus) && (source === "all" || (order.source_name || "Unknown") === source) && (refundFilter === "all" || refundFilter === "refunded" && order.refunded > 0 || refundFilter === "not-refunded" && order.refunded === 0));
  const dailyRows = data?.breakdowns.date ?? [];
  const groupedDailyRows = (() => {
    if (groupBy === "daily" || !data?.period || !dailyRows.length) return dailyRows;
    const periods = reportingPeriods(data.period.start, data.period.end, groupBy, 1000);
    return periods.map((period): SalesBreakdownRow => {
      const rows = dailyRows.filter((row) => row.label >= period.start && row.label <= period.end);
      const sum = (key: keyof SalesBreakdownRow) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
      return { label: period.label, orders: sum("orders"), units: sum("units"), sales: sum("sales"), refunds: sum("refunds"), cogs: sum("cogs"), paymentFees: sum("paymentFees"), grossProfit: sum("grossProfit"), salesWithoutRecordedCost: sum("salesWithoutRecordedCost"), missingCostLines: sum("missingCostLines") };
    }).filter((row) => row.orders || row.sales);
  })();
  const breakdownRows = breakdownDimension === "date" ? groupedDailyRows : data?.breakdowns[breakdownDimension] ?? [];
  const breakdownLabels: Record<SalesBreakdownDimension, string> = { date: "Date", channel: "Sales channel", customerType: "Customer type", country: "Country", discountCode: "Discount code", product: "Product" };
  const exportSales = () => downloadCsv("shopify-orders.csv", [["Report", "Sales orders"], ["Period", data?.period ? `${data.period.start} to ${data.period.end}` : "No imported orders"], ["Timezone", data?.timezone || "UTC"], ["Currency", data?.currency || "GBP"], ["Filters", [search.trim() ? `Search: ${search.trim()}` : "", financialStatus !== "all" ? `Payment: ${financialStatus}` : "", fulfilmentStatus !== "all" ? `Fulfilment: ${fulfilmentStatus}` : "", source !== "all" ? `Source: ${source}` : "", refundFilter !== "all" ? `Refunds: ${refundFilter}` : ""].filter(Boolean).join(" · ") || "None"], ["Generated at", new Date().toISOString()], [], ["Order", "Date", "Financial status", "Fulfilment status", "Source", "Product sales", "Refunds", "Shipping", "Total"], ...visibleOrders.map((order) => [order.order_name, order.processed_at || "", order.financial_status || "", order.fulfillment_status || "", order.source_name || "", Number(order.net_product_sales), order.refunded, Number(order.shipping_revenue), Number(order.total_sales)])]);
  const openDetail = async (id: string) => { setDetail(null); setDetailError(""); setDetailLoading(true); try { const response = await fetch(`/api/analytics/orders/${encodeURIComponent(id)}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load order"); setDetail(payload); } catch (reason) { setDetailError(reason instanceof Error ? reason.message : "Could not load order"); } finally { setDetailLoading(false); } };
  const applySalesDatePreset = (preset: FinanceDatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = financeDateRange(preset);
    setFromDate(range.from); setToDate(range.to);
  };
  return <><FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={applySalesDatePreset} onFrom={(value) => { setDatePreset("custom"); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setToDate(value); }} groupBy={groupBy} onGroupBy={setGroupBy}/><section className="panel report-panel sales-breakdown"><div className="panel-head"><div><span className="eyebrow">SALES BREAKDOWN</span><h2>Understand what drives sales</h2></div><div className="feature-actions"><span className="report-note">{data ? `${data.analysisOrderCount.toLocaleString()} orders analysed` : "Loading sales analysis…"}</span><select aria-label="Sales breakdown" value={breakdownDimension} onChange={(event) => setBreakdownDimension(event.target.value as SalesBreakdownDimension)}><option value="date">By date</option><option value="channel">By channel</option><option value="customerType">By new/repeat customer</option><option value="country">By country</option><option value="discountCode">By discount code</option><option value="product">By product</option></select></div></div>{breakdownDimension === "date" ? <span className="report-note">{data?.dailySource === "shopifyql" ? "Daily totals come from ShopifyQL, the same analytics engine used by Shopify Admin. Payment fees come from Shopify's fees report." : "Reconnect Shopify with read_reports to use Shopify Admin-matched daily totals."}</span> : breakdownDimension === "product" ? <span className="report-note">Product sales are after discounts; refunds remain at order level until refund allocation is available.</span> : breakdownDimension === "discountCode" ? <span className="report-note">Orders using multiple codes split units and net sales evenly so totals remain additive.</span> : null}<div className="table-scroll"><table className="data-table"><thead>{breakdownDimension === "date" ? <tr><th>Date</th><th>Orders</th><th>Units</th><th>Net sales</th><th>Refunds</th><th>COGS</th><th>Gross profit</th><th>Payment fees</th><th>Profit after fees</th></tr> : <tr><th>{breakdownLabels[breakdownDimension]}</th><th>Orders</th><th>Units</th><th>Net sales</th><th>Average order value</th></tr>}</thead><tbody>{!data ? <tr><td colSpan={breakdownDimension === "date" ? 9 : 5} className="empty-row">Calculating sales breakdown…</td></tr> : breakdownRows.length ? breakdownRows.map((row) => breakdownDimension === "date" ? <tr key={row.label}><td><strong>{/^\d{4}-\d{2}-\d{2}$/.test(row.label) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${row.label}T00:00:00Z`)) : row.label}</strong></td><td>{row.orders.toLocaleString()}</td><td>{row.units.toLocaleString()}</td><td><strong>{formatter.format(row.sales)}</strong></td><td>{formatter.format(-(row.refunds ?? 0))}</td><td><strong>{formatter.format(row.cogs ?? 0)}</strong>{(row.salesWithoutRecordedCost ?? 0) > 0 ? <small>{row.missingCostLines ? `${row.missingCostLines.toLocaleString()} imported lines missing cost · ` : ""}{formatter.format(row.salesWithoutRecordedCost ?? 0)} of Shopify sales missing recorded cost</small> : null}</td><td><strong>{formatter.format(row.grossProfit ?? row.sales - (row.cogs ?? 0))}</strong></td><td>{formatter.format(-(row.paymentFees ?? 0))}</td><td><strong>{formatter.format((row.grossProfit ?? row.sales - (row.cogs ?? 0)) - (row.paymentFees ?? 0))}</strong></td></tr> : <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.orders.toLocaleString()}</td><td>{row.units.toLocaleString()}</td><td><strong>{formatter.format(row.sales)}</strong></td><td>{row.orders ? formatter.format(row.sales / row.orders) : "—"}</td></tr>) : <tr><td colSpan={breakdownDimension === "date" ? 9 : 5} className="empty-row">No sales in this period.</td></tr>}</tbody></table></div></section><section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">SHOPIFY ORDERS</span><h2>Sales and orders</h2></div><div className="feature-actions"><span className="report-note">Most recent 250 imported orders</span><button className="export-button" disabled={!visibleOrders.length} onClick={exportSales}><Download/> Export CSV</button></div></div><div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders or status..."/></div><select aria-label="Financial status" value={financialStatus} onChange={(event) => setFinancialStatus(event.target.value)}><option value="all">All payments</option>{financialStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Fulfilment status" value={fulfilmentStatus} onChange={(event) => setFulfilmentStatus(event.target.value)}><option value="all">All fulfilment</option>{fulfilmentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Sales source" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Refund status" value={refundFilter} onChange={(event) => setRefundFilter(event.target.value)}><option value="all">All refund states</option><option value="refunded">Refunded</option><option value="not-refunded">Not refunded</option></select></div>{data && !data.hasData ? <div className="cost-empty"><ShoppingBag/><strong>No Shopify orders yet</strong><span>Connect Shopify and run the first sync to populate sales.</span></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Date</th><th>Financial status</th><th>Fulfilment</th><th>Source</th><th>Product sales</th><th>Refunds</th><th>Shipping</th><th>Total</th></tr></thead><tbody>{!data ? <tr><td colSpan={9} className="empty-row">Loading orders…</td></tr> : visibleOrders.length === 0 ? <tr><td colSpan={9} className="empty-row">No orders match that search.</td></tr> : visibleOrders.map((order) => <tr key={order.id}><td><button className="table-link" onClick={() => void openDetail(order.id)}><strong>{order.order_name}</strong></button></td><td>{order.processed_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(order.processed_at)) : "—"}</td><td>{order.financial_status || "—"}</td><td>{order.fulfillment_status || "—"}</td><td>{order.source_name || "—"}</td><td>{formatter.format(Number(order.net_product_sales))}</td><td>{order.refunded ? formatter.format(-order.refunded) : "—"}</td><td>{formatter.format(Number(order.shipping_revenue))}</td><td><strong>{formatter.format(Number(order.total_sales))}</strong></td></tr>)}</tbody></table></div>}</section>{(detailLoading || detail || detailError) && <div className="modal-backdrop" onMouseDown={() => { if (!detailLoading) { setDetail(null); setDetailError(""); } }}><section className="connection-modal order-drawer" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" disabled={detailLoading} onClick={() => { setDetail(null); setDetailError(""); }}><X/></button>{detailLoading ? <div className="data-loading">Loading order details…</div> : detailError ? <div className="connection-error">{detailError}</div> : detail && <><div className="modal-brand"><span className="source-logo s"><ShoppingBag/></span><div><span className="eyebrow">ORDER PROFITABILITY</span><h2>{detail.order.order_name}</h2></div></div><div className="order-detail-grid"><div><span>Product sales</span><strong>{formatter.format(Number(detail.order.net_product_sales))}</strong></div><div><span>Refunds</span><strong>{formatter.format(-detail.metrics.refunds)}</strong></div><div><span>Product COGS</span><strong>{detail.metrics.missingCostLines ? "Partial" : formatter.format(-detail.metrics.cogs)}</strong></div><div><span>Gross profit</span><strong>{detail.metrics.missingCostLines ? "Coverage needed" : formatter.format(detail.metrics.grossProfit)}</strong></div></div>{detail.metrics.missingCostLines > 0 && <div className="connection-notice"><Info/><div><strong>{detail.metrics.missingCostLines} line items are missing a cost</strong><span>Gross profit is incomplete until effective-dated product costs are added.</span></div></div>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Line item</th><th>SKU</th><th>Qty</th><th>Net sales</th><th>Unit cost</th><th>COGS</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td><strong>{line.title}</strong><small>{line.variant_title || ""}</small></td><td>{line.sku || "—"}</td><td>{line.current_quantity}</td><td>{formatter.format(Number(line.net_sales))}</td><td>{line.unitCost === null ? "Missing" : formatter.format(line.unitCost)}</td><td>{line.cogs === null ? "Missing" : formatter.format(line.cogs)}</td></tr>)}</tbody></table></div></>}</section></div>}</>;
}

type ProductProfit = { key: string; product: string; variant: string; sku: string | null; units: number; revenue: number; discounts: number; refunds: number; netRevenue: number; cogs: number; grossProfit: number; margin: number | null; missingCostUnits: number; shippingCosts: number; handlingCosts: number; transactionFeeAllocation: number; marketingAllocation: number; contributionProfit: number; contributionMargin: number | null; trend: Array<{ period: string; units: number; revenue: number; refunds: number; netRevenue: number }> };
type ProductData = { hasData: boolean; currency: string; timezone: string; marketingCurrencyCoverage: CurrencyConversionCoverage; period: { start: string; end: string } | null; products: ProductProfit[] };

function Products({ openCosts, reportRunId, initialRange }: { openCosts: (sku: string | null) => void; reportRunId?: string; initialRange?: DrilldownContext }) {
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
    {loading ? <div className="data-loading">Calculating product profitability…</div> : data && !data.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to see product profitability</strong><span>Revenue, costs, and contribution margin become available after your first order sync.</span></div></div> : null}{data?.marketingCurrencyCoverage.convertedRows ? <div className="connection-notice"><Info/><div><strong>{data.marketingCurrencyCoverage.convertedRows.toLocaleString()} advertising spend rows converted to {data.currency}</strong><span>Converted spend is allocated across products by net revenue.</span></div></div> : null}{data?.marketingCurrencyCoverage.excludedRows ? <div className="connection-notice"><Info/><div><strong>{data.marketingCurrencyCoverage.excludedRows.toLocaleString()} advertising spend rows excluded</strong><span>Add dated exchange rates before treating product contribution profit as complete.</span></div></div> : null}
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

type CustomerRow = { id: string; display_name: string | null; number_of_orders: number; amount_spent: number; currency: string; last_order_at: string | null; country_code?: string | null };
type CustomerData = {
  hasData: boolean;
  currency: string;
  timezone: string;
  period: { start: string; end: string } | null;
  metrics: { customers: number; repeatCustomers: number; repeatCustomerRate: number | null; newCustomerOrders: number; newCustomerSales: number; repeatCustomerOrders: number; repeatCustomerSales: number; guestOrders: number; guestSales: number; repeatRevenueRate: number | null; repeatOrderRate: number | null; newCustomerAverageOrderValue: number | null; repeatCustomerAverageOrderValue: number | null; averageOrdersPerCustomer: number | null; averageCustomerValue: number | null; averageDaysToSecondOrder: number | null };
  customers: CustomerRow[];
  locations: Array<{ countryCode: string; orders: number; customers: number; sales: number }>;
  customerDetailsMasked?: boolean;
  months: Array<{ key: string; newCustomerOrders: number; newCustomerSales: number; repeatCustomerOrders: number; repeatCustomerSales: number }>;
  cohorts: Array<{ key: string; customers: number; periods: Array<{ period: number; activeCustomers: number; retentionRate: number; revenue: number; cumulativeRevenue: number }> }>;
  behavior: {
    repurchaseWindows: Array<{ days: number; customers: number; repurchased: number; rate: number | null }>;
    averageTimeBetweenOrders: number | null;
    timeBetweenOrders: Array<{ label: string; count: number; share: number; cumulativeShare: number }>;
    productBreakdown: Array<{ product: string; sku: string | null; customers: number; repurchasers: number; averageSalesPerCustomer: number; repurchasedAnythingRate: number; repurchasedSameProductRate: number; averageDaysBetweenOrders: number | null }>;
    productJourneys: Array<{ from: string; to: string; customers: number }>;
    journeyPaths: Array<{ depth: number; products: string[]; customers: number }>;
    journeyCountsByDepth: Array<{ depth: number; customers: number }>;
  };
};


const customerChartColors = ["#7660ed", "#25a8da", "#ed8d64", "#25b59b", "#ce75d6", "#d4ad41", "#617ebd", "#de7297"];
function CustomerBehaviorChart({ behavior, kind }: { behavior: CustomerData["behavior"]; kind: "repurchase" | "timing" | "journeys" }) {
  const [active, setActive] = useState<number | null>(null);
  const [limit, setLimit] = useState(12);
  const [showTable, setShowTable] = useState(false);
  const journeys = [...behavior.productJourneys].filter(row => row.customers > 0).sort((a,b) => b.customers-a.customers).slice(0,limit);
  const rows = kind === "repurchase" ? behavior.repurchaseWindows.map(row => ({ label: row.days + " days", value: row.rate === null ? null : row.rate*100, cumulative: null as number | null, detail: row.repurchased.toLocaleString() + " of " + row.customers.toLocaleString() + " customers" })) : behavior.timeBetweenOrders.map(row => ({label: row.label, value: row.share*100, cumulative: row.cumulativeShare*100, detail: row.count.toLocaleString() + " repeat orders"}));
  const selected = active === null ? null : rows[active];
  const total = journeys.reduce((sum,row) => sum+row.customers,0);
  const nodeNames = (side: "from" | "to") => Array.from(new Set(journeys.map(row=>row[side])));
  const names = {from:nodeNames("from"),to:nodeNames("to")};
  const plotHeight = Math.max(380, Math.max(names.from.length,names.to.length)*48);
  const nodeLayout = (side: "from" | "to") => {
    const available = plotHeight - Math.max(0,names[side].length-1)*18;
    let y = 42;
    return names[side].map(name => {const count=journeys.filter(row=>row[side]===name).reduce((sum,row)=>sum+row.customers,0);const height=count/Math.max(1,total)*available;const node={name,count,y,height,offset:0};y+=height+18;return node;});
  };
  const left = nodeLayout("from"), right=nodeLayout("to");
  const links=journeys.map((row,index)=>{const source=left.find(node=>node.name===row.from)!;const target=right.find(node=>node.name===row.to)!;const sh=source.height*row.customers/source.count,th=target.height*row.customers/target.count;const sy=source.y+source.offset,ty=target.y+target.offset;source.offset+=sh;target.offset+=th;return {row,index,path:`M 254 ${sy} C 405 ${sy}, 495 ${ty}, 646 ${ty} L 646 ${ty+th} C 495 ${ty+th},405 ${sy+sh},254 ${sy+sh} Z`,color:customerChartColors[left.indexOf(source)%customerChartColors.length]};});
  const available = kind === "journeys" ? journeys.length > 0 : rows.some(row=>row.value !== null) && (kind !== "timing" || behavior.timeBetweenOrders.some(row=>row.count>0));
  const pct=(value:number|null)=>value===null?"Unavailable":value.toFixed(1)+"%";
  const x=(i:number)=>64+(i+.5)*780/Math.max(rows.length,1);
  const y=(value:number)=>306-value/100*250;
  return <div className="customer-viz">
    <div className="customer-viz-toolbar"><div className="customer-viz-legend"><span><i style={{background:"#7660ed"}}/>{kind==="journeys"?"Width represents customers":kind==="timing"?"Share of repeat orders":"Repurchased within window"}</span>{kind==="timing"&&<span><i style={{background:"#25b59b"}}/>Cumulative share</span>}</div><div>{kind==="journeys"&&<label>Paths <select value={limit} onChange={event=>{setLimit(Number(event.target.value));setActive(null);}}><option value={8}>Top 8</option><option value={12}>Top 12</option><option value={20}>Top 20</option></select></label>}<button type="button" aria-pressed={showTable} onClick={()=>setShowTable(!showTable)}>{showTable?"Show graph":"View chart data"}</button></div></div>
    {!available ? <p className="customer-viz-empty">Not enough repeat-purchase data for this chart yet.</p> : showTable ? <div className="table-scroll"><table className="data-table"><thead><tr>{(kind==="journeys"?["First product","Next product","Customers"]:["Window","Share","Details"]).map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{kind==="journeys"?journeys.map((row,i)=><tr key={i}><td>{row.from}</td><td>{row.to}</td><td>{row.customers}</td></tr>):rows.map(row=><tr key={row.label}><td>{row.label}</td><td>{pct(row.value)}</td><td>{row.detail}</td></tr>)}</tbody></table></div> : <><div className="customer-viz-scroll">
      {kind==="journeys"?<svg viewBox={`0 0 900 ${plotHeight+85}`} className="customer-journey-svg" role="img" aria-label="Customer product journeys from first order to second order">
        <text x="236" y="22" textAnchor="end" className="customer-viz-heading">FIRST ORDER</text><text x="664" y="22" className="customer-viz-heading">SECOND ORDER</text>
        {links.map(({row,index,path,color})=><path key={index} d={path} fill={color} opacity={active===null?.32:active===index?.8:.09} tabIndex={0} role="button" aria-label={`${row.from} to ${row.to}: ${row.customers} customers`} onMouseEnter={()=>setActive(index)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(index)} onBlur={()=>setActive(null)} onClick={()=>setActive(index)}><title>{row.from} → {row.to}: {row.customers} customers</title></path>)}
        {(["from","to"] as const).flatMap(side=>(side==="from"?left:right).map((node,index)=><g key={side+node.name}><rect x={side==="from"?242:646} y={node.y} width="12" height={node.height} rx="3" fill={customerChartColors[index%customerChartColors.length]}/><text x={side==="from"?230:670} y={node.y+node.height/2-2} textAnchor={side==="from"?"end":"start"} className="customer-viz-label"><title>{node.name}</title>{node.name.length>30?node.name.slice(0,29)+"…":node.name}<tspan x={side==="from"?230:670} dy="15" fill="#8791a7">{node.count.toLocaleString()} customers</tspan></text></g>))}
      </svg>:<svg viewBox="0 0 900 368" className="customer-rate-svg" role="img" aria-label={kind==="timing"?"Share and cumulative share of repeat orders by days between orders":"Repurchase rate by days after first order"}>
        {[0,25,50,75,100].map(tick=><g key={tick}><line x1="64" x2="844" y1={y(tick)} y2={y(tick)} stroke="#e7eaf3" strokeDasharray="4 5"/><text x="52" y={y(tick)+4} textAnchor="end" className="customer-viz-label">{tick}%</text></g>)}
        {kind==="repurchase"&&rows.map((row,i)=>row.value!==null&&i>0&&rows[i-1].value!==null?<path key={i} d={`M ${x(i-1)} ${y(0)} L ${x(i-1)} ${y(rows[i-1].value!)} L ${x(i)} ${y(row.value)} L ${x(i)} ${y(0)} Z`} fill="#7660ed" opacity=".1"/>:null)}
        {kind==="timing"&&<polyline points={rows.map((row,i)=>`${x(i)},${y(row.cumulative??0)}`).join(" ")} fill="none" stroke="#25b59b" strokeWidth="3"/>}
        {rows.map((row,i)=><g key={row.label} tabIndex={0} role="button" aria-label={row.label+": "+pct(row.value)+", "+row.detail} onMouseEnter={()=>setActive(i)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onClick={()=>setActive(i)}>
          <rect x={x(i)-390/rows.length} y="40" width={780/rows.length} height="286" fill={active===i?"#7660ed09":"transparent"}/>
          {row.value!==null&&<rect x={x(i)-Math.min(22,260/rows.length)} y={y(row.value)} width={Math.min(44,520/rows.length)} height={250*row.value/100} rx="4" fill={kind==="timing"?"#25a8da":"#7660ed"}/>}
          {kind==="timing"&&<circle cx={x(i)} cy={y(row.cumulative??0)} r="4" fill="white" stroke="#25b59b" strokeWidth="2"/>}
          <text x={x(i)} y={row.value===null?292:y(row.value)-9} textAnchor="middle" className="customer-viz-label">{row.value===null?"N/A":pct(row.value)}</text>
          <text x={x(i)} y="330" textAnchor="middle" className="customer-viz-label customer-viz-x-label">{kind==="timing" ? row.label.replace(" days", "") : row.label}</text>
        </g>)}
        <text x="454" y="359" textAnchor="middle" className="customer-viz-label">{kind==="timing"?"Days between consecutive orders":"Days after the first order"}</text>
      </svg>}
    </div><div className="customer-viz-detail" aria-live="polite">{active!==null&&kind==="journeys"&&journeys[active]?<><strong>{journeys[active].from} → {journeys[active].to}</strong><span>{journeys[active].customers.toLocaleString()} customers · {(journeys[active].customers/Math.max(total,1)*100).toFixed(1)}% of displayed journeys</span></>:selected&&kind!=="journeys"?<><strong>{selected.label} · {pct(selected.value)}</strong><span>{selected.detail}{selected.cumulative!==null?" · "+pct(selected.cumulative)+" cumulative":""}</span></>:<span>Hover, tap, or focus a {kind==="journeys"?"path":"column"} to explore the numbers.</span>}</div></>}
    {kind==="journeys"&&<p className="customer-viz-note">Showing {journeys.length} paths from first to second order, based on the first product in each order. Colours and widths describe the displayed paths only.</p>}
  </div>;
}

function Customers({ reportRunId, initialRange, focus = "summary" }: { reportRunId?: string; initialRange?: DrilldownContext; focus?: CustomerFocus }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<CustomerData | null>(null);
  const [profitData, setProfitData] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cohortMetric, setCohortMetric] = useState<"retention" | "revenue">("retention");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(initialRange?.from || "");
  const [toDate, setToDate] = useState(initialRange?.to || "");
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange ? "custom" : "all_imported");
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    Promise.all([
      fetch(`/api/analytics/customers${params.size ? `?${params}` : ""}`).then(async (response) => response.ok ? response.json() as Promise<CustomerData> : null),
      fetch(`/api/analytics/pnl${params.size ? `?${params}` : ""}`).then(async (response) => response.ok ? response.json() as Promise<PnlData> : null),
    ])
      .then(([payload, profit]) => { setData(payload); setProfitData(profit); finishReportRun(payload ? "completed" : "failed", payload?.customers.length ?? null); })
      .catch(() => { setData(null); setProfitData(null); finishReportRun("failed", null, "Customer data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [finishReportRun, fromDate, toDate]);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const profitPerNewCustomer = calculateProfitPerNewCustomer(profitData?.metrics.netProfit ?? null, data?.metrics.newCustomerOrders ?? 0);
  const metrics = data ? [
    ["CUSTOMERS", data.metrics.customers.toLocaleString(), `${data.metrics.repeatCustomers.toLocaleString()} repeat customers`],
    ["NEW-CUSTOMER SALES", formatter.format(data.metrics.newCustomerSales), `${data.metrics.newCustomerOrders.toLocaleString()} first orders · ${data.metrics.newCustomerAverageOrderValue === null ? "—" : formatter.format(data.metrics.newCustomerAverageOrderValue)} AOV`],
    ["REPEAT SALES", formatter.format(data.metrics.repeatCustomerSales), data.metrics.repeatRevenueRate === null ? "No repeat sales yet" : `${(data.metrics.repeatRevenueRate * 100).toFixed(1)}% sales · ${data.metrics.repeatOrderRate === null ? "—" : (data.metrics.repeatOrderRate * 100).toFixed(1) + "%"} repeat orders · ${data.metrics.repeatCustomerAverageOrderValue === null ? "—" : formatter.format(data.metrics.repeatCustomerAverageOrderValue)} AOV`],
    ["REPEAT CUSTOMER RATE", data.metrics.repeatCustomerRate === null ? "—" : `${(data.metrics.repeatCustomerRate * 100).toFixed(1)}%`, "Customers with more than one order"],
    ["NET PROFIT PER NEW CUSTOMER", profitPerNewCustomer === null ? "—" : formatter.format(profitPerNewCustomer), !profitData?.availability.netProfit ? "Complete cost coverage is required" : data.metrics.newCustomerOrders ? "Period net profit ÷ first orders · blended" : "No new customers in this period"],
  ] : [];
  const exportCustomers = () => { if (data) downloadCsv("shopify-customers.csv", [["Report", "Shopify customers"], ["Period", data.period ? `${data.period.start} to ${data.period.end}` : "No imported orders"], ["Timezone", data.timezone], ["Currency", data.currency], ["Filters", "Top 50 customers by sales in the selected period"], ["Generated at", new Date().toISOString()], [], ["Customer", "Orders in period", "Sales in period", "Last order"], ...data.customers.map((customer) => [customer.display_name || "Unnamed customer", customer.number_of_orders, Number(customer.amount_spent), customer.last_order_at || ""])]); };
  return <div className={`customer-behaviour customer-focus-${focus}`}><FinanceDateControls preset={datePreset} from={fromDate} to={toDate} onPreset={(preset) => { setDatePreset(preset); if (preset !== "custom") { const range = financeDateRange(preset); setLoading(true); setFromDate(range.from); setToDate(range.to); } }} onFrom={(value) => { setDatePreset("custom"); setLoading(true); setFromDate(value); }} onTo={(value) => { setDatePreset("custom"); setLoading(true); setToDate(value); }}/>{loading ? <div className="data-loading">Calculating customer metrics…</div> : !data?.hasData ? <div className="connection-notice"><Info/><div><strong>No detailed Shopify orders in this period</strong><span>Try All imported data to see the available order history, or refresh the Shopify order import.</span></div></div> : <><section className="metric-grid">{metrics.map(([label, value, hint]) => <article className="metric-card" key={label}><div className="metric-head"><span>{label}</span><Users/></div><strong>{value}</strong><div className="metric-foot"><span>{hint}</span></div></article>)}</section><section className="cost-grid live"><div><strong>{data.metrics.averageCustomerValue === null ? "—" : formatter.format(data.metrics.averageCustomerValue)}</strong><span>Average customer value</span></div><div><strong>{data.metrics.averageOrdersPerCustomer === null ? "—" : data.metrics.averageOrdersPerCustomer.toFixed(2)}</strong><span>Orders per customer</span></div><div><strong>{data.metrics.averageDaysToSecondOrder === null ? "—" : `${data.metrics.averageDaysToSecondOrder.toFixed(0)} days`}</strong><span>Average time to second order</span></div></section><section data-customer-section="repurchase" className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">REPURCHASE RATE</span><h2>New-customer repurchase windows</h2></div><span className="report-note">Customers who placed another order within each window of their first order.</span></div><div className="report-summary">{data.behavior.repurchaseWindows.map((window) => <div key={window.days}><span>Within {window.days} days</span><strong>{window.rate === null ? "—" : `${(window.rate * 100).toFixed(1)}%`}</strong><small>{window.repurchased.toLocaleString()} of {window.customers.toLocaleString()} customers</small></div>)}</div><CustomerBehaviorChart behavior={data.behavior} kind="repurchase"/></section><section data-customer-section="timing" className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">TIME BETWEEN ORDERS</span><h2>{data.behavior.averageTimeBetweenOrders === null ? "No repeat-order gaps yet" : `${data.behavior.averageTimeBetweenOrders.toFixed(1)} days on average`}</h2></div><span className="report-note">Distribution of consecutive valid Shopify orders.</span></div><CustomerBehaviorChart behavior={data.behavior} kind="timing"/><div className="table-scroll"><table className="data-table"><thead><tr><th>Days between orders</th><th>Repeat orders</th><th>Share</th><th>Cumulative share</th></tr></thead><tbody>{data.behavior.timeBetweenOrders.filter((bucket) => bucket.count).map((bucket) => <tr key={bucket.label}><td><strong>{bucket.label}</strong></td><td>{bucket.count.toLocaleString()}</td><td>{(bucket.share * 100).toFixed(1)}%</td><td>{(bucket.cumulativeShare * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></section><section data-customer-section="repurchase" className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">REPURCHASE BREAKDOWN</span><h2>First product and repeat behaviour</h2></div><span className="report-note">Grouped by the product in a customer’s first imported order.</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>First-order product</th><th>SKU</th><th>Customers</th><th>Repurchasers</th><th>Average sales / customer</th><th>Repurchased anything</th><th>Repurchased same product</th><th>Time between orders</th></tr></thead><tbody>{data.behavior.productBreakdown.length ? data.behavior.productBreakdown.map((row) => <tr key={`${row.product}-${row.sku ?? ""}`}><td><strong>{row.product}</strong></td><td>{row.sku || "—"}</td><td>{row.customers.toLocaleString()}</td><td>{row.repurchasers.toLocaleString()}</td><td>{formatter.format(row.averageSalesPerCustomer)}</td><td>{(row.repurchasedAnythingRate * 100).toFixed(1)}%</td><td>{(row.repurchasedSameProductRate * 100).toFixed(1)}%</td><td>{row.averageDaysBetweenOrders === null ? "—" : `${row.averageDaysBetweenOrders.toFixed(0)} days`}</td></tr>) : <tr><td colSpan={8} className="empty-row">No first-product repeat behaviour in this period.</td></tr>}</tbody></table></div></section><section data-customer-section="journeys" className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">PRODUCT JOURNEY</span><h2>Products across repeat orders</h2></div><span className="report-note">Choose how many orders to follow for each customer.</span></div><ProductJourneyChart paths={data.behavior.journeyPaths ?? []} countsByDepth={data.behavior.journeyCountsByDepth ?? []}/></section>{data.customerDetailsMasked ? <div className="connection-notice"><Info/><div><strong>Customer names are masked for your role</strong><span>Sales and retention metrics remain available. Ask a workspace owner or admin for customer-level access.</span></div></div> : null}{data.metrics.guestOrders > 0 ? <div className="connection-notice"><Info/><div><strong>{data.metrics.guestOrders.toLocaleString()} guest orders are separate from customer cohorts</strong><span>{formatter.format(data.metrics.guestSales)} is excluded from new-versus-repeat classification because Shopify has no customer record for these orders.</span></div></div> : null}<section data-customer-section="customer-trend" className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CUSTOMER TREND</span><h2>New versus repeat sales</h2></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>New orders</th><th>New-customer sales</th><th>Repeat orders</th><th>Repeat sales</th></tr></thead><tbody>{data.months.length ? [...data.months].reverse().map((month) => <tr key={month.key}><td>{new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(`${month.key}-01T00:00:00Z`))}</td><td>{month.newCustomerOrders.toLocaleString()}</td><td><strong>{formatter.format(month.newCustomerSales)}</strong></td><td>{month.repeatCustomerOrders.toLocaleString()}</td><td><strong>{formatter.format(month.repeatCustomerSales)}</strong></td></tr>) : <tr><td colSpan={5} className="empty-row">No customer trend data yet.</td></tr>}</tbody></table></div></section><section data-customer-section="cohorts" className="panel report-panel cohort-panel">
  <div className="panel-head cohort-panel-head">
    <div><span className="eyebrow">RETENTION COHORTS</span><h2>Customers retained after their first order</h2><p className="cohort-explainer">Each row is a first-order month. Month 0 is the starting group; later months show who returned.</p></div>
    <label className="cohort-metric-select">Show
      <select aria-label="Cohort metric" value={cohortMetric} onChange={(event) => setCohortMetric(event.target.value as "retention" | "revenue")}><option value="retention">Customer retention</option><option value="revenue">Cumulative revenue</option></select>
    </label>
  </div>
  <div className="cohort-legend" aria-label="Heatmap key"><span>Colour key</span><i className="cohort-legend-empty"/>No activity<i className="cohort-legend-low"/>Lower<i className="cohort-legend-high"/>Higher<span className="cohort-legend-note">Intensity compares values across the visible cohorts; Month 0 is the baseline.</span></div>
  <div className="table-scroll cohort-table-scroll"><table className="data-table cohort-table"><thead><tr><th>First-order cohort</th><th>Customers</th>{Array.from({ length: 7 }, (_, period) => <th key={period}>{period === 0 ? "Month 0 · baseline" : `Month ${period}`}</th>)}</tr></thead><tbody>{data.cohorts.length ? data.cohorts.map((cohort) => <tr key={cohort.key}><td className="cohort-month">{new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(`${cohort.key}-01T00:00:00Z`))}</td><td className="cohort-size">{cohort.customers.toLocaleString()}</td>{cohort.periods.map((period) => {
    const value = cohortMetric === "retention" ? period.retentionRate : period.cumulativeRevenue;
    const otherValues = data.cohorts.flatMap((row) => row.periods.filter((entry) => entry.period > 0).map((entry) => cohortMetric === "retention" ? entry.retentionRate : entry.cumulativeRevenue));
    const maxValue = Math.max(...otherValues, 0);
    const intensity = period.period === 0 || value <= 0 || maxValue === 0 ? 0 : Math.max(0.12, Math.min(1, value / maxValue));
    const backgroundColor = period.period === 0 ? "#f0edff" : value <= 0 ? "#f8fafc" : cohortMetric === "retention" ? `hsl(166 63% ${97 - intensity * 22}%)` : `hsl(254 80% ${97 - intensity * 18}%)`;
    const detail = cohortMetric === "retention" ? `${period.activeCustomers.toLocaleString()} of ${cohort.customers.toLocaleString()} customers returned` : `${formatter.format(period.cumulativeRevenue)} cumulative revenue`;
    return <td className={`cohort-cell ${period.period === 0 ? "cohort-baseline" : value <= 0 ? "cohort-empty" : "cohort-active"}`} key={period.period} style={{ backgroundColor }} title={`${cohort.key} · Month ${period.period}: ${detail}`}>
      <strong>{cohortMetric === "retention" ? (period.period > 0 && period.activeCustomers === 0 ? "—" : `${(period.retentionRate * 100).toFixed(1)}%`) : period.cumulativeRevenue === 0 ? "—" : formatter.format(period.cumulativeRevenue)}</strong>
      <small>{cohortMetric === "retention" ? period.period === 0 ? "starting customers" : period.activeCustomers ? `${period.activeCustomers.toLocaleString()} returned` : "no repeat orders" : period.period === 0 ? "starting revenue" : `through Month ${period.period}`}</small>
    </td>;
  })}</tr>) : <tr><td colSpan={9} className="empty-row">No customer cohorts yet.</td></tr>}</tbody></table></div>
</section><section data-customer-section="customer-value" className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CUSTOMER VALUE</span><h2>Top Shopify customers</h2></div><button className="export-button" disabled={!data.customers.length} onClick={exportCustomers}><Download/> Export CSV</button></div><div className="customer-location-panel"><div><span className="eyebrow">CUSTOMER LOCATION</span><h3>Orders by country</h3><p>Choose a country to filter the top customer list. Based on shipping country in the selected period.</p></div><button className={"location-country-chip" + (selectedCountry === null ? " selected" : "")} onClick={() => setSelectedCountry(null)}><strong>All countries</strong><span>{data.locations.reduce((sum, location) => sum + location.orders, 0).toLocaleString()} orders</span></button><div className="location-country-list">{data.locations.map((location) => {const maxOrders = Math.max(...data.locations.map((item) => item.orders), 1);const active = selectedCountry === location.countryCode;return <button key={location.countryCode} className={"location-country-row" + (active ? " selected" : "")} onClick={() => setSelectedCountry(active ? null : location.countryCode)}><span className="location-country-name"><strong>{new Intl.DisplayNames(["en"], { type: "region" }).of(location.countryCode) || location.countryCode}</strong><small>{location.customers.toLocaleString()} customers · {location.orders.toLocaleString()} orders</small></span><span className="location-bar"><i style={{width:Math.max(4, location.orders / maxOrders * 100) + "%"}}/></span><strong className="location-sales">{formatter.format(location.sales)}</strong></button>})}{!data.locations.length && <div className="empty-row">No country data in this period.</div>}</div><small className="customer-location-note">City and region aren't included in the current Shopify location data.</small></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Customer</th><th>Country</th><th>Orders in period</th><th>Sales in period</th><th>Last order</th></tr></thead><tbody>{data.customers.filter((customer) => !selectedCountry || customer.country_code === selectedCountry).map((customer) => <tr key={customer.id}><td>{customer.display_name || "Unnamed customer"}</td><td>{customer.country_code ? new Intl.DisplayNames(["en"], { type: "region" }).of(customer.country_code) || customer.country_code : "—"}</td><td>{customer.number_of_orders.toLocaleString()}</td><td>{formatter.format(Number(customer.amount_spent))}</td><td>{customer.last_order_at ? new Date(customer.last_order_at).toLocaleDateString("en-GB") : "—"}</td></tr>)}{data.customers.filter((customer) => !selectedCountry || customer.country_code === selectedCountry).length === 0 && <tr><td colSpan={5} className="empty-row">No top customers are recorded for this country in the selected period.</td></tr>}</tbody></table></div></section></>}</div>;
}

type SavedReport = { id: string; name: string; description: string | null; report_type: "overview" | "pnl" | "sales" | "products" | "customers" | "utm"; visibility: "private" | "organization"; is_favorite: boolean; configuration: { schemaVersion?: number; datePreset?: "all_imported" | "latest_30_days" | "latest_90_days"; utmFilters?: DrilldownContext }; definition_version: number; last_successful_run_at: string | null; updated_at: string };
type SavedReportRun = { id: string; report_id: string; definition_version: number; status: "running" | "completed" | "failed"; row_count: number | null; error_message: string | null; started_at: string; completed_at: string | null };
const reportViews: Record<SavedReport["report_type"], View> = { overview: "Overview", pnl: "Profit & Loss", sales: "Sales", products: "Products", customers: "Customers", utm: "UTM Analysis" };
const reportTypeLabels: Record<SavedReport["report_type"], string> = { overview: "Overview", pnl: "Profit & Loss", sales: "Sales orders", products: "Product profitability", customers: "Customers", utm: "UTM analysis" };
const datePresetLabels = { all_imported: "All imported data", latest_30_days: "Latest 30 days", latest_90_days: "Latest 90 days" } as const;

function Reports({ openReport }: { openReport: (view: View, preset: "all_imported" | "latest_30_days" | "latest_90_days", runId: string, filters?: DrilldownContext) => void }) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", description: "", reportType: "pnl", visibility: "private", datePreset: "all_imported" });
  const [editing, setEditing] = useState<SavedReport | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", visibility: "private" });
  const [runHistoryReport, setRunHistoryReport] = useState<SavedReport | null>(null);
  const [runHistory, setRunHistory] = useState<SavedReportRun[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const load = useCallback(() => fetch(`/api/reports${showArchived ? "?archived=true" : ""}`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load reports"); setReports(payload.reports ?? []); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load reports")).finally(() => setLoading(false)), [showArchived]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save report");
      setShowSave(false); setForm({ name: "", description: "", reportType: "pnl", visibility: "private", datePreset: "all_imported" }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save report"); } finally { setSaving(false); }
  };
  const updateReport = async (payload: Record<string, unknown>, fallback: string) => {
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) { const responsePayload = await response.json(); throw new Error(responsePayload.error || fallback); }
      await load();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : fallback); return false; }
  };
  const toggleFavorite = (report: SavedReport) => updateReport({ id: report.id, isFavorite: !report.is_favorite }, "Could not update favourite");
  const duplicate = (report: SavedReport) => updateReport({ id: report.id, action: "duplicate" }, "Could not duplicate report");
  const archive = (report: SavedReport) => updateReport({ id: report.id, action: "archive" }, "Could not archive report");
  const restore = (report: SavedReport) => updateReport({ id: report.id, action: "restore" }, "Could not restore report");
  const beginRename = (report: SavedReport) => { setEditing(report); setEditForm({ name: report.name, description: report.description || "", visibility: report.visibility }); };
  const rename = async () => {
    if (!editing) return;
    const updated = await updateReport({ id: editing.id, action: "rename", name: editForm.name, description: editForm.description, visibility: editForm.visibility }, "Could not update report");
    if (updated) setEditing(null);
  };
  const runReport = async (report: SavedReport) => {
    setError("");
    const response = await fetch("/api/reports/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId: report.id }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error || "Could not start report"); return; }
    openReport(reportViews[report.report_type], report.configuration?.datePreset ?? "all_imported", payload.run.id, report.configuration?.utmFilters);
  };
  const showRunHistory = async (report: SavedReport) => {
    setRunHistoryReport(report); setRunHistory([]); setRunHistoryLoading(true); setError("");
    try {
      const response = await fetch(`/api/reports/runs?reportId=${encodeURIComponent(report.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load run history");
      setRunHistory(payload.runs ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load run history");
      setRunHistoryReport(null);
    } finally {
      setRunHistoryLoading(false);
    }
  };
  return <><section className="cost-toolbar"><div><span className="eyebrow">REPORT LIBRARY</span><h2>Saved reports</h2><p>Keep the report views you revisit, then share them with your workspace when ready.</p></div><div className="feature-actions"><button onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Current reports" : "Archived reports"}</button>{!showArchived && <button className="primary" onClick={() => setShowSave(true)}><Plus/> Save report</button>}</div></section><section className="panel report-panel starter-reports"><div className="panel-head"><div><span className="eyebrow">STARTER TEMPLATES</span><h2>Begin with a trusted view</h2></div></div><div className="template-grid">{starterReports.map((template) => <button key={template.name} onClick={() => { setForm({ name: template.name, description: template.description, reportType: template.reportType, visibility: "private", datePreset: template.datePreset }); setShowSave(true); }}><strong>{template.name}</strong><span>{template.description}</span></button>)}</div></section>{error && <div className="connection-error cost-error">{error}</div>}<section className="panel report-panel">{loading ? <div className="data-loading">Loading saved reports…</div> : reports.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Report</th><th>Version</th><th>Type</th><th>Access</th><th>Period</th><th>Last successful run</th><th>Updated</th><th/></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.name}</strong>{report.description && <small>{report.description}</small>}</td><td>v{report.definition_version}</td><td>{reportTypeLabels[report.report_type]}</td><td>{report.visibility === "organization" ? "Workspace shared" : "Private"}</td><td>{datePresetLabels[report.configuration?.datePreset ?? "all_imported"]}</td><td>{report.last_successful_run_at ? new Date(report.last_successful_run_at).toLocaleString("en-GB") : "Not run yet"}</td><td>{new Date(report.updated_at).toLocaleDateString("en-GB")}</td><td><div className="feature-actions"><button className={report.is_favorite ? "favourite-report active" : "favourite-report"} title={report.is_favorite ? "Remove favourite" : "Add favourite"} onClick={() => void toggleFavorite(report)}>{report.is_favorite ? "★" : "☆"}</button><button onClick={() => void runReport(report)}>Open</button><button onClick={() => void showRunHistory(report)}>History</button><button onClick={() => beginRename(report)}>Rename</button><button onClick={() => void duplicate(report)}>Duplicate</button>{showArchived ? <button onClick={() => void restore(report)}>Restore</button> : <button className="icon-button" title="Archive report" onClick={() => void archive(report)}><Trash2/></button>}</div></td></tr>)}</tbody></table></div> : <div className="cost-empty"><Table2/><strong>No saved reports yet</strong><span>Save a report configuration to keep it in your library.</span></div>}</section>{showSave && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowSave(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><Table2/></span><div><span className="eyebrow">REPORT LIBRARY</span><h2>Save report</h2></div></div><label className="form-field"><span>Report name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Weekly P&L"/></label><label className="form-field"><span>Report type</span><select value={form.reportType} onChange={(event) => setForm({ ...form, reportType: event.target.value })}>{Object.entries(reportTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>Access</span><select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}><option value="private">Private to me</option><option value="organization">Share with workspace</option></select></label><label className="form-field"><span>Date range</span><select value={form.datePreset} onChange={(event) => setForm({ ...form, datePreset: event.target.value })}>{Object.entries(datePresetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>Description <small>Optional</small></span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What this view is for"/></label><div className="modal-actions"><button onClick={() => setShowSave(false)}>Cancel</button><button className="primary" disabled={!form.name.trim() || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save report"}</button></div></section></div>}{editing && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setEditing(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><Table2/></span><div><span className="eyebrow">REPORT LIBRARY</span><h2>Edit report</h2></div></div><label className="form-field"><span>Report name</span><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}/></label><label className="form-field"><span>Access</span><select value={editForm.visibility} onChange={(event) => setEditForm({ ...editForm, visibility: event.target.value })}><option value="private">Private to me</option><option value="organization">Share with workspace</option></select></label><label className="form-field"><span>Description <small>Optional</small></span><input value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}/></label><div className="modal-actions"><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={!editForm.name.trim()} onClick={() => void rename()}>Save changes</button></div></section></div>}{runHistoryReport && <div className="modal-backdrop" onMouseDown={() => setRunHistoryReport(null)}><section className="connection-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setRunHistoryReport(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><RefreshCw/></span><div><span className="eyebrow">REPORT HISTORY</span><h2>{runHistoryReport.name}</h2></div></div>{runHistoryLoading ? <div className="data-loading">Loading report runs…</div> : runHistory.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Started</th><th>Version</th><th>Status</th><th>Rows</th><th>Result</th></tr></thead><tbody>{runHistory.map((run) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString("en-GB")}</td><td>v{run.definition_version}</td><td><strong>{run.status}</strong></td><td>{run.row_count?.toLocaleString() ?? "—"}</td><td>{run.status === "failed" ? run.error_message || "Report failed" : run.completed_at ? `Completed ${new Date(run.completed_at).toLocaleTimeString("en-GB")}` : "In progress"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><RefreshCw/><strong>No report runs yet</strong><span>Open this saved report to create its first tracked run.</span></div>}<div className="modal-actions"><button onClick={() => setRunHistoryReport(null)}>Close</button><button className="primary" onClick={() => { const report = runHistoryReport; setRunHistoryReport(null); void runReport(report); }}><RefreshCw/> Run again</button></div></section></div>}</>;
}

type ExchangeRateRow = { id: string; base_currency: string; quote_currency: string; rate: string; effective_date: string; source: string; notes: string | null; updated_at: string };
type ConnectionAuditEvent = { id: string; provider: "meta" | "shopify" | "google_ads" | "klaviyo"; action: "credential_created" | "credential_rotated" | "connection_deleted" | "scopes_updated"; actor_user_id: string; metadata: { scope_count?: number }; created_at: string };
type StoreCostDefaults = { fulfilmentAmount: string; fulfilmentBasis: "orders" | "units"; postageAmount: string; postageBasis: "orders" | "units"; defaultCogsPercent: string; currency: string };

function SettingsView() {
  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [connectionAudit, setConnectionAudit] = useState<ConnectionAuditEvent[]>([]);
  const [auditUserId, setAuditUserId] = useState("");
  const [auditLoading, setAuditLoading] = useState(true);
  const [reportingCurrency, setReportingCurrency] = useState("GBP");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [creatingBrand, setCreatingBrand] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [currentBrandName, setCurrentBrandName] = useState("");
  const [businessModel, setBusinessModel] = useState<"ecommerce" | "lead_generation">("ecommerce");
  const [savingBrandName, setSavingBrandName] = useState(false);
  const [deletingBrand, setDeletingBrand] = useState(false);
  const [error, setError] = useState("");
  const [costDefaults, setCostDefaults] = useState<StoreCostDefaults>({ fulfilmentAmount: "0", fulfilmentBasis: "orders", postageAmount: "0", postageBasis: "orders", defaultCogsPercent: "0", currency: "GBP" });
  const [form, setForm] = useState({ baseCurrency: "USD", rate: "", effectiveDate: new Date().toISOString().slice(0, 10), notes: "" });
  const loadRates = useCallback(() => fetch("/api/settings/exchange-rates").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load exchange rates"); setRates(payload.rates ?? []); setReportingCurrency(payload.reportingCurrency || "GBP"); setCanManage(Boolean(payload.canManage)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load exchange rates")).finally(() => setLoading(false)), []);
  useEffect(() => { void loadRates(); }, [loadRates]);
  const loadCostDefaults = useCallback(() => fetch("/api/settings/cost-defaults").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load cost defaults"); setCostDefaults(payload.defaults); setCanManage(Boolean(payload.canManage)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load cost defaults")), []);
  useEffect(() => { void loadCostDefaults(); }, [loadCostDefaults]);
  useEffect(() => { fetch("/api/workspace").then((response) => response.ok ? response.json() : null).then((payload) => { const store = payload?.stores?.find((item: { id: string }) => item.id === payload.activeStoreId); setCurrentBrandName(store?.name ?? ""); setBusinessModel(store?.businessModel === "lead_generation" ? "lead_generation" : "ecommerce"); }).catch(() => undefined); }, []);
  const saveCostDefaults = async () => {
    setSavingDefaults(true); setError("");
    try {
      const response = await fetch("/api/settings/cost-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(costDefaults) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save cost defaults");
      setCostDefaults(payload.defaults);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save cost defaults"); } finally { setSavingDefaults(false); }
  };
  const loadConnectionAudit = useCallback(() => fetch("/api/settings/connection-audit").then(async (response) => { if (response.status === 403) return null; const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load connection security history"); setConnectionAudit(payload.events ?? []); setAuditUserId(payload.currentUserId ?? ""); return payload; }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load connection security history")).finally(() => setAuditLoading(false)), []);
  useEffect(() => { const timeout = window.setTimeout(() => void loadConnectionAudit(), 0); return () => window.clearTimeout(timeout); }, [loadConnectionAudit]);
  const saveCurrentBrandSettings = async () => {
    setSavingBrandName(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: currentBrandName, businessModel }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save brand settings");
      setCurrentBrandName(payload.store.name);
      setBusinessModel(payload.store.business_model === "lead_generation" ? "lead_generation" : "ecommerce");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save brand settings"); }
    finally { setSavingBrandName(false); }
  };
  const deleteCurrentBrand = async () => {
    const confirmed = window.confirm(`Delete "${currentBrandName || "this brand"}"? This permanently removes its connections, imported data, costs and reports. This cannot be undone.`);
    if (!confirmed) return;
    setDeletingBrand(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not delete this brand");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this brand"); }
    finally { setDeletingBrand(false); }
  };
  const createBrand = async () => {
    setCreatingBrand(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: brandName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create brand");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create brand"); setCreatingBrand(false); }
  };
  const saveRate = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/exchange-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, quoteCurrency: reportingCurrency }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save exchange rate");
      setForm({ ...form, rate: "", notes: "" }); await loadRates();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save exchange rate"); } finally { setSaving(false); }
  };
  const deleteRate = async (id: string) => {
    setError("");
    const response = await fetch(`/api/settings/exchange-rates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json(); setError(payload.error || "Could not delete exchange rate"); return; }
    await loadRates();
  };
  return <><section className="cost-toolbar"><div><span className="eyebrow">FINANCIAL SETTINGS</span><h2>Store cost defaults</h2><p>Set the fulfilment and postage assumptions used by profit reporting for this brand.</p></div></section>{error && <div className="connection-error cost-error">{error}</div>}<section className="panel report-panel brand-settings"><div className="panel-head"><div><span className="eyebrow">CURRENT BRAND</span><h2>Brand settings</h2><p>Set the active brand's name and reporting model. The navigation updates to show only the pages that model needs.</p></div></div><div className="filter-row"><label>Brand name<input value={currentBrandName} disabled={!canManage || savingBrandName} maxLength={80} onChange={(event) => setCurrentBrandName(event.target.value)} placeholder="Brand name"/></label><label>Business model<select value={businessModel} disabled={!canManage || savingBrandName} onChange={(event) => setBusinessModel(event.target.value as "ecommerce" | "lead_generation")}><option value="ecommerce">Ecommerce</option><option value="lead_generation">Lead generation</option></select><small>{businessModel === "lead_generation" ? "Shows Leads, connections and settings." : "Shows ecommerce reporting, products and customer insights."}</small></label>{canManage && <button className="primary" disabled={savingBrandName || deletingBrand || currentBrandName.trim().length < 2} onClick={() => void saveCurrentBrandSettings()}>{savingBrandName ? "Saving…" : "Save brand settings"}</button>}</div>{canManage && <div className="brand-danger"><div><strong>Delete this brand</strong><span>Deletes this brand and all of its stored data. You will switch to another brand.</span></div><button className="danger-button" disabled={savingBrandName || deletingBrand} onClick={() => void deleteCurrentBrand()}>{deletingBrand ? "Deleting…" : "Delete brand"}</button></div>}</section><section className="panel report-panel brand-settings"><div className="panel-head"><div><span className="eyebrow">BRANDS</span><h2>Add another brand</h2><p>Each brand has its own Shopify, Meta, Google Ads, and Klaviyo connections, costs, and reporting data.</p></div></div><div className="filter-row"><label>Brand name<input value={brandName} disabled={!canManage || creatingBrand} maxLength={80} onChange={(event) => setBrandName(event.target.value)} placeholder="New brand"/></label>{canManage && <button className="primary" disabled={creatingBrand || brandName.trim().length < 2} onClick={() => void createBrand()}>{creatingBrand ? "Creating…" : "Create and switch"}</button>}</div></section><section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">ORDER ECONOMICS</span><h2>Fulfilment and postage</h2><p>Product shipping overrides take priority over the postage default. Use the COGS rate only when a product does not have its own Shopify or manual unit cost.</p></div><span className="report-note">{costDefaults.currency}</span></div><div className="filter-row"><label>Default COGS rate (%)<input inputMode="decimal" min="0" max="100" value={costDefaults.defaultCogsPercent} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, defaultCogsPercent: event.target.value })}/></label><label>Fulfilment cost<input inputMode="decimal" min="0" value={costDefaults.fulfilmentAmount} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, fulfilmentAmount: event.target.value })}/></label><label>Fulfilment basis<select value={costDefaults.fulfilmentBasis} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, fulfilmentBasis: event.target.value as "orders" | "units" })}><option value="orders">Per order</option><option value="units">Per unit</option></select></label><label>Postage cost<input inputMode="decimal" min="0" value={costDefaults.postageAmount} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, postageAmount: event.target.value })}/></label><label>Postage basis<select value={costDefaults.postageBasis} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, postageBasis: event.target.value as "orders" | "units" })}><option value="orders">Per order</option><option value="units">Per unit</option></select></label>{canManage && <button className="primary" disabled={savingDefaults} onClick={() => void saveCostDefaults()}>{savingDefaults ? "Saving…" : "Save defaults"}</button>}</div></section><section className="cost-toolbar"><div><span className="eyebrow">CURRENCY SETTINGS</span><h2>Exchange rates</h2><p>Add dated rates before Spine converts Shopify Markets orders into {reportingCurrency}. Until then, those orders remain excluded from consolidated totals.</p></div></section>{canManage && <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">MANUAL RATE</span><h2>Add or replace a dated rate</h2></div></div><div className="filter-row"><label>Source currency<input value={form.baseCurrency} maxLength={3} onChange={(event) => setForm({ ...form, baseCurrency: event.target.value.toUpperCase() })}/></label><label>Reporting currency<input value={reportingCurrency} disabled/></label><label>Rate<input inputMode="decimal" value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} placeholder="0.7900000000"/></label><label>Effective date<input type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })}/></label><label>Notes<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional source or rationale"/></label><button className="primary" disabled={saving || !form.rate || form.baseCurrency.length !== 3} onClick={() => void saveRate()}>{saving ? "Saving…" : "Save rate"}</button></div></section>}<section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">RATE HISTORY</span><h2>Effective-dated conversions</h2></div><span className="report-note">One unit of source currency equals the listed reporting-currency amount.</span></div>{loading ? <div className="data-loading">Loading exchange rates…</div> : rates.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Effective date</th><th>Conversion</th><th>Source</th><th>Notes</th><th/></tr></thead><tbody>{rates.map((rate) => <tr key={rate.id}><td>{new Date(`${rate.effective_date}T00:00:00Z`).toLocaleDateString("en-GB")}</td><td><strong>1 {rate.base_currency} = {Number(rate.rate).toLocaleString("en-GB", { maximumFractionDigits: 10 })} {rate.quote_currency}</strong></td><td>{rate.source}</td><td>{rate.notes || "—"}</td><td>{canManage && <button className="icon-button" title="Delete rate" onClick={() => void deleteRate(rate.id)}><Trash2/></button>}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><CircleDollarSign/><strong>No exchange rates yet</strong><span>Foreign-currency orders remain excluded until a dated rate is available.</span></div>}</section>{canManage && <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CONNECTION SECURITY</span><h2>Credential audit history</h2></div><span className="report-note">Owner/admin view · secret values are never recorded.</span></div>{auditLoading ? <div className="data-loading">Loading credential history…</div> : connectionAudit.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Time</th><th>Provider</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>{connectionAudit.map((event) => <tr key={event.id}><td>{new Date(event.created_at).toLocaleString("en-GB")}</td><td>{event.provider === "google_ads" ? "Google Ads" : event.provider.charAt(0).toUpperCase() + event.provider.slice(1)}</td><td><strong>{({ credential_created: "Credential created", credential_rotated: "Credential rotated", connection_deleted: "Connection deleted", scopes_updated: "Shopify scopes updated" } as const)[event.action]}</strong></td><td>{event.actor_user_id === auditUserId ? "You" : `User …${event.actor_user_id.slice(-6)}`}</td><td>{event.action === "scopes_updated" ? `${event.metadata.scope_count ?? 0} scopes recorded` : "No secret values stored"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><KeyRound/><strong>No credential changes recorded yet</strong><span>Future connection changes will appear here for owners and admins.</span></div>}</section>}</>;
}

function Generic({ view }: { view: View }) { return <section className="panel empty-feature"><div className="feature-icon"><BarChart3/></div><span className="eyebrow">COMING INTO FOCUS</span><h2>{view}</h2><p>The product shell is ready. This report will use the same trusted Shopify financial model, filters and export workflow.</p><button className="primary"><Plus/> Create report</button></section>; }

type Freshness = { connected: boolean; storeName: string | null; lastSuccessfulSync: string | null; recordsProcessed: number; warnings: number; latestStatus: string | null; latestError: string | null };
type WorkspaceData = {
  activeOrganizationId: string;
  activeStoreId: string | null;
  organizations: Array<{ id: string; name: string; role: "owner" | "admin" | "analyst" | "viewer" }>;
  stores: Array<{ id: string; organizationId: string; name: string; currency: string; reportingCurrency: string; timezone: string; businessModel: "ecommerce" | "lead_generation" }>;
};

export function AnalyticsApp() {
  const [view, setView] = useState<View>("Overview");
  const [costSku, setCostSku] = useState<string | null>(null);
  const [pnlPreset, setPnlPreset] = useState<"all_imported" | "latest_30_days" | "latest_90_days" | "latest_365_days">("latest_365_days");
  const [activeReportRun, setActiveReportRun] = useState<{ id: string; view: View } | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownContext | null>(null);
  const [account, setAccount] = useState({ name: "Account", email: "" });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customersExpanded, setCustomersExpanded] = useState(true);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [switchingStore, setSwitchingStore] = useState(false);
  const [leadDatePreset, setLeadDatePreset] = useState<FinanceDatePreset>("all_imported");
  const [leadFrom, setLeadFrom] = useState("");
  const [leadTo, setLeadTo] = useState("");
  const [leadDatePickerOpen, setLeadDatePickerOpen] = useState(false);
  const [leadDateReady, setLeadDateReady] = useState(false);
  const router = useRouter();
  const activeStore = workspace?.stores.find((store) => store.id === workspace.activeStoreId);
  const activeStoreName = activeStore?.name || freshness?.storeName || "Your store";
  const businessModel = activeStore?.businessModel ?? "ecommerce";
  useEffect(() => {
    if (!activeStore?.id) return;
    const key = `spine:lead-period:${activeStore.id}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const value = JSON.parse(saved) as { preset?: FinanceDatePreset; from?: string; to?: string };
        if (value.preset && ["today", "yesterday", "last_7_days", "last_7_complete_days", "last_30_days", "last_30_complete_days", "last_90_days", "last_365_days", "this_month", "last_month", "all_imported", "custom"].includes(value.preset)) {
          setLeadDatePreset(value.preset);
          setLeadFrom(value.from ?? "");
          setLeadTo(value.to ?? "");
        }
      }
    } catch { /* Ignore a malformed saved date filter. */ }
    setLeadDateReady(true);
  }, [activeStore?.id]);
  useEffect(() => {
    if (!leadDateReady || !activeStore?.id) return;
    localStorage.setItem(`spine:lead-period:${activeStore.id}`, JSON.stringify({ preset: leadDatePreset, from: leadFrom, to: leadTo }));
  }, [activeStore?.id, leadDatePreset, leadFrom, leadTo, leadDateReady]);
  const availableNav = businessModel === "lead_generation" ? leadGenerationNav : ecommerceNav;
  useEffect(() => {
    if (!availableNav.some((item) => item.label === view)) setView("Overview");
  }, [availableNav, view]);
  useEffect(() => {
    fetch("/api/workspace")
      .then(async (response) => response.ok ? response.json() as Promise<WorkspaceData> : null)
      .then((payload) => setWorkspace(payload))
      .catch(() => setWorkspace(null));
    fetch("/api/analytics/freshness")
      .then(async (response) => response.ok ? response.json() as Promise<Freshness> : null)
      .then((payload) => setFreshness(payload))
      .catch(() => setFreshness(null));
  }, []);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => { const user = data.user; if (!user) return; const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : typeof user.user_metadata?.name === "string" ? user.user_metadata.name : ""; setAccount({ name: metadataName || user.email?.split("@")[0] || "Account", email: user.email || "" }); }); }, []);
  const switchStore = async (storeId: string) => {
    const store = workspace?.stores.find((candidate) => candidate.id === storeId);
    if (!store || store.id === workspace?.activeStoreId) return;
    setSwitchingStore(true);
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: store.organizationId, storeId: store.id }),
    }).catch(() => null);
    if (!response?.ok) {
      setSwitchingStore(false);
      return;
    }
    window.location.reload();
  };
  const leadRangeLabel = leadDatePreset === "custom" && leadFrom && leadTo ? `${leadFrom} to ${leadTo}` : leadDatePreset === "all_imported" ? "All imported data" : ({ today: "Today", yesterday: "Yesterday", last_7_days: "Last 7 days", last_7_complete_days: "Last 7 complete days", last_30_days: "Last 30 days", last_30_complete_days: "Last 30 complete days", last_90_days: "Last 90 days", last_365_days: "Last 365 days", this_month: "This month", last_month: "Last month", custom: "Custom dates", all_imported: "All imported data" } as Record<FinanceDatePreset, string>)[leadDatePreset];
  const updateLeadPreset = (preset: FinanceDatePreset) => { setLeadDatePreset(preset); if (preset !== "custom") { const dates = financeDateRange(preset); setLeadFrom(dates.from); setLeadTo(dates.to); } };
  const logout = async () => { await createClient().auth.signOut(); router.push("/auth/login"); router.refresh(); };
  const openSync = () => { setDrilldown(null); setView("Connections"); setMobileOpen(false); };
  const openDrilldown = (target: View, context?: DrilldownContext) => { setActiveReportRun(null); setDrilldown(context ?? null); setView(target); setMobileOpen(false); };
  const freshnessHeading = !freshness ? "SHOPIFY DATA" : !freshness.connected ? "SHOPIFY NOT CONNECTED" : freshness.latestStatus === "running" ? "IMPORTING SHOPIFY" : freshness.latestStatus === "failed" || freshness.latestStatus === "interrupted" ? "SYNC NEEDS ATTENTION" : freshness.lastSuccessfulSync ? "SHOPIFY SYNCED" : "READY TO SYNC";
  const freshnessDetail = freshness?.latestStatus === "running" ? "Importing your Shopify catalogue and orders" : freshness?.latestStatus === "interrupted" ? "Open Connections to resume the saved import" : freshness?.lastSuccessfulSync ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(freshness.lastSuccessfulSync)) : freshness?.latestStatus === "failed" ? "Open Connections to review the failed sync" : "Open Connections to import Shopify data";
  return <div className="app-shell">
    <aside className={mobileOpen?"sidebar open":"sidebar"}><div className="brand"><span className="brand-mark"><Image src="/spine-logo.png" alt="" width={34} height={34} priority /></span><span><b>Spine</b><small>The backbone of your business</small></span><button className="mobile-close" onClick={()=>setMobileOpen(false)}><X/></button></div><label className="store-switcher"><span className="store-icon"><ShoppingBag/></span><span><small>STORE</small><b>{switchingStore ? "Switching…" : activeStoreName}</b></span><select aria-label="Active store" value={workspace?.activeStoreId ?? ""} disabled={!workspace || switchingStore || workspace.stores.length < 2} onChange={(event)=>void switchStore(event.target.value)}>{workspace?.stores.map((store)=>{const organization=workspace?.organizations.find((candidate)=>candidate.id===store.organizationId);return <option key={store.id} value={store.id}>{organization && (workspace?.organizations.length ?? 0) > 1 ? `${organization.name} · ` : ""}{store.name}</option>})}</select><ChevronDown/></label><nav>{availableNav.map((item)=>{if(item.subItem&&!customersExpanded)return null;const isCustomers=item.label==="Customers";return <div key={item.label}>{item.section&&<span className="nav-section">{item.section}</span>}<button className={`${view===item.label ? "nav-item active" : "nav-item"}${item.subItem ? " nav-sub-item" : ""}`} onClick={()=>{if(isCustomers)setCustomersExpanded((expanded)=>!expanded);setActiveReportRun(null);setDrilldown(null);setView(item.label);setMobileOpen(false)}}><item.icon/><span>{item.display ?? item.label}</span>{isCustomers&&<ChevronDown style={{marginLeft:"auto",transform:customersExpanded?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s"}}/>}</button></div>})}</nav><div className="sidebar-bottom"><button className="nav-item" onClick={logout}><LogOut/><span>Sign out</span></button><div className="user-card"><div>{account.name.slice(0, 2).toUpperCase()}</div><span><b>{account.name}</b><small>{account.email}</small></span></div></div></aside>
    <main className="main"><header className="topbar"><button className="menu-button" onClick={()=>setMobileOpen(true)}><Menu/></button><div className="breadcrumb"><span>{activeStoreName}</span><b>/</b><strong>{view}</strong></div><div className="top-actions"><div className="global-date-picker"><button className="date-button" title="Choose reporting period" onClick={() => setLeadDatePickerOpen((open) => !open)}><CalendarDays/><span>{leadRangeLabel}</span><ChevronDown/></button>{leadDatePickerOpen && <div className="global-date-menu"><label>Period<select value={leadDatePreset} onChange={(event) => updateLeadPreset(event.target.value as FinanceDatePreset)}><option value="all_imported">All imported data</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="custom">Custom dates</option></select></label>{leadDatePreset === "custom" && <div className="global-date-custom"><label>From<input type="date" value={leadFrom} onChange={(event) => setLeadFrom(event.target.value)}/></label><label>To<input type="date" value={leadTo} onChange={(event) => setLeadTo(event.target.value)}/></label></div>}<button className="primary" onClick={() => setLeadDatePickerOpen(false)}>Apply period</button></div>}</div><button className="icon-button" onClick={openSync} title="Open Shopify sync"><RefreshCw/></button><button className="export-button" onClick={()=>setView("Reports")}><Table2/> Reports</button></div></header>
      <div className="content"><div className="page-heading"><div><span className="eyebrow">{businessModel === "lead_generation" ? "LEAD GENERATION INTELLIGENCE" : "ECOMMERCE INTELLIGENCE"}</span><h1>{view}</h1><p>{view==="Leads"?"A standalone view of ad cost against your selected GoHighLevel conversion.":view==="Overview"?(businessModel === "lead_generation" ? "Monitor GoHighLevel stage volumes, paid-media efficiency and pipeline value." : "A clear view of what your store earned—not just what it sold."):view==="UTM Analysis"?"Understand which traffic sources create profitable customers.":view==="Profit & Loss"?"Your ecommerce income statement, based on all imported Shopify data.":`Manage and analyse your ${view.toLowerCase()}.`}</p></div><div className="freshness"><span className={freshness?.latestStatus === "failed" ? "sync-dot syncing" : "sync-dot"}/><div><small>{freshnessHeading}</small><b>{freshnessDetail}</b></div></div></div>
        {view==="Overview"?(businessModel === "lead_generation" ? <LeadOverview range={{ from: leadFrom, to: leadTo, label: leadRangeLabel }} onOpenConnections={() => setView("Connections")} onOpenLeads={() => setView("Leads")}/> : <Overview reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} onDrilldown={openDrilldown} storageKey={activeStore?.id ?? "default"}/>):view==="Leads"?<Leads onOpenConnections={() => setView("Connections")} range={{ from: leadFrom, to: leadTo, label: leadRangeLabel, preset: leadDatePreset }} onRangeChange={(next) => { if (next.preset) updateLeadPreset(next.preset); if (next.from !== undefined) { setLeadDatePreset("custom"); setLeadFrom(next.from); } if (next.to !== undefined) { setLeadDatePreset("custom"); setLeadTo(next.to); } }}/>:(["Pipeline outcomes","Stage ageing","Lead sources","Sales team","Forecast","Lost reasons","Follow-ups"] as View[]).includes(view)?<LeadReportPage view={view as "Pipeline outcomes" | "Stage ageing" | "Lead sources" | "Sales team" | "Forecast" | "Lost reasons" | "Follow-ups"} range={{from:leadFrom,to:leadTo,label:leadRangeLabel}}/>:view==="Profit & Loss"?<ProfitLoss savedPreset={pnlPreset} initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Sales"?<Sales reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="UTM Analysis"?<UTMAnalysis initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Products"?<Products initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} openCosts={(sku) => { setCostSku(sku); setDrilldown(null); setView("Costs"); }}/>:(view==="New versus repeat sales" || view==="Top Shopify customers" || view==="Sales by country")?<ShopifyCustomerReport focus={view==="New versus repeat sales"?"sales":view==="Sales by country"?"geography":"customers"}/>: (["Customers", "Customer cohorts", "Repurchase rates", "Time between orders", "Product journeys"] as View[]).includes(view)?<Customers initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} focus={view === "Customer cohorts" ? "cohorts" : view === "Repurchase rates" ? "repurchase" : view === "Time between orders" ? "timing" : view === "Product journeys" ? "journeys" : "summary"}/>:view==="Costs"?<Costs focusSku={costSku}/>:view==="Expenses"?<Expenses/>:view==="Reports"?<Reports openReport={(target, preset, runId, filters) => { setPnlPreset(preset); setDrilldown(filters ?? null); setActiveReportRun({ id: runId, view: target }); setView(target); }}/> :view==="Connections"?<Connections/>:view==="Settings"?<SettingsView/>:<Generic view={view}/>}</div>
    </main>
  </div>;
}



