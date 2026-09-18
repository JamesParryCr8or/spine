"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { reportingPeriods, type ReportingGranularity, type ReportingPeriod } from "@/lib/analytics/reporting-periods";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown,
  CircleDollarSign, Database, Download, Eye, EyeOff, ExternalLink, FileBarChart, Info, KeyRound, LayoutDashboard,
  LogOut, Megaphone, Menu, Package, Plus, RefreshCw, Search, Settings,
  ShoppingBag, Sparkles, Table2, TrendingUp, Upload, Users, WalletCards, X, Trash2,
} from "lucide-react";

type View = "Overview" | "Profit & Loss" | "Sales" | "UTM Analysis" | "Products" | "Customers" | "Costs" | "Expenses" | "Reports" | "Connections";

const nav: { label: View; icon: typeof LayoutDashboard; section?: string }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Profit & Loss", icon: FileBarChart, section: "REPORTING" },
  { label: "Sales", icon: ShoppingBag },
  { label: "UTM Analysis", icon: Megaphone },
  { label: "Products", icon: Package },
  { label: "Customers", icon: Users },
  { label: "Costs", icon: WalletCards, section: "DATA" },
  { label: "Expenses", icon: WalletCards },
  { label: "Reports", icon: Table2 },
  { label: "Connections", icon: Database },
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

const channels = [
  { name: "Meta Ads", spend: "£12,480", revenue: "£91,240", roas: "7.3x", share: 79, color: "#7357ff" },
  { name: "Google Ads", spend: "£8,320", revenue: "£58,730", roas: "7.1x", share: 62, color: "#18b981" },
  { name: "Klaviyo", spend: "£1,240", revenue: "£38,910", roas: "31.4x", share: 43, color: "#ff9f43" },
  { name: "Organic", spend: "—", revenue: "£44,206", roas: "—", share: 48, color: "#37a3ff" },
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

type CurrencyCoverage = { reportingCurrency: string; includedOrders: number; excludedOrders: number; excludedCurrencies: Array<{ currency: string; orders: number }> };

type OverviewData = {
  hasData: boolean;
  currency: string;
  currencyCoverage: CurrencyCoverage;
  range: { start: string; end: string };
  metrics: { grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number; unitsSold: number; averageOrderValue: number; marketingSpend: number; newCustomers: number; newCustomerSales: number; blendedCac: number | null; blendedMer: number | null; newCustomerRoas: number | null };
  months: Array<{ key: string; label: string; grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number }>;
  meta?: { importedDays: number; start: string | null; end: string | null };
};

function Overview({ reportRunId }: { reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [liveData, setLiveData] = useState<OverviewData | null>(null);
  const [pnlSummary, setPnlSummary] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/analytics/overview").then(async (response) => response.ok ? response.json() as Promise<OverviewData> : null),
      fetch("/api/analytics/pnl").then(async (response) => response.ok ? response.json() as Promise<PnlData> : null),
    ])
      .then(([overview, pnl]) => { setLiveData(overview); setPnlSummary(pnl); finishReportRun(overview ? "completed" : "failed", overview?.metrics.orders ?? null); })
      .catch(() => { setLiveData(null); setPnlSummary(null); finishReportRun("failed", null, "Overview data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [finishReportRun]);

  const hasLiveData = Boolean(liveData?.hasData);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: liveData?.currency || "GBP", maximumFractionDigits: 0 });
  const liveMetrics = liveData ? [
    { label: "Net sales", value: formatter.format(liveData.metrics.netSales), delta: "Live Shopify data", positive: true, hint: `${liveData.metrics.orders.toLocaleString()} orders` },
    { label: "Orders", value: liveData.metrics.orders.toLocaleString(), delta: "Imported Shopify orders", positive: true, hint: `${liveData.metrics.unitsSold.toLocaleString()} units sold` },
    { label: "Units sold", value: liveData.metrics.unitsSold.toLocaleString(), delta: "Current quantities", positive: true, hint: `${liveData.metrics.orders ? (liveData.metrics.unitsSold / liveData.metrics.orders).toFixed(1) : "0.0"} units per order` },
    { label: "Average order value", value: formatter.format(liveData.metrics.averageOrderValue), delta: "Net product sales", positive: true, hint: `${liveData.metrics.orders.toLocaleString()} completed orders` },
    { label: "Gross sales", value: formatter.format(liveData.metrics.grossSales), delta: "Before discounts", positive: true, hint: `${formatter.format(liveData.metrics.discounts)} discounts` },
    { label: "Shipping revenue", value: formatter.format(liveData.metrics.shippingRevenue), delta: "Shopify orders", positive: true, hint: "Excludes tax and duties" },
    { label: "Blended CAC", value: liveData.metrics.blendedCac === null ? "—" : formatter.format(liveData.metrics.blendedCac), delta: "Meta spend ÷ new customers", positive: true, hint: `${liveData.metrics.newCustomers.toLocaleString()} first-observed customers` },
    { label: "Blended MER", value: liveData.metrics.blendedMer === null ? "—" : `${liveData.metrics.blendedMer.toFixed(2)}x`, delta: "Net sales ÷ Meta spend", positive: true, hint: liveData.metrics.marketingSpend ? `${formatter.format(liveData.metrics.marketingSpend)} imported spend` : "Connect Meta spend" },
    { label: "New-customer ROAS", value: liveData.metrics.newCustomerRoas === null ? "—" : `${liveData.metrics.newCustomerRoas.toFixed(2)}x`, delta: "First observed order sales", positive: true, hint: "Uses blended Meta spend for the imported window" },
    { label: "Gross profit", value: pnlSummary?.hasData ? formatter.format(pnlSummary.metrics.grossProfit) : "—", delta: "Net product sales less refunds and COGS", positive: true, hint: pnlSummary?.metrics.missingCostLines ? `${pnlSummary.metrics.missingCostLines.toLocaleString()} lines need costs` : "Product costs covered" },
    { label: "Marketing cost", value: pnlSummary?.availability.marketingSpend ? formatter.format(pnlSummary.metrics.marketingSpend) : "—", delta: "Imported Meta spend", positive: true, hint: pnlSummary?.availability.marketingSpend ? "Matching reporting currency" : "Connect Meta spend" },
    { label: "Contribution margin", value: pnlSummary?.availability.marketingSpend && pnlSummary.availability.shippingCosts && pnlSummary.availability.handlingCosts ? formatter.format(pnlSummary.metrics.contributionMargin) : "—", delta: "After variable direct costs", positive: true, hint: pnlSummary?.availability.shippingCosts && pnlSummary?.availability.handlingCosts ? "Shipping and handling included" : "Complete shipping and handling costs" },
    { label: "Net profit", value: pnlSummary?.availability.netProfit && pnlSummary.metrics.netProfit !== null ? formatter.format(pnlSummary.metrics.netProfit) : "—", delta: "After known operating costs", positive: true, hint: pnlSummary?.availability.netProfit ? `${pnlSummary.metrics.netMargin === null ? "—" : `${(pnlSummary.metrics.netMargin * 100).toFixed(1)}%`} net margin` : "Complete cost coverage" },
  ] : demoMetrics;
  const chartMonths = hasLiveData ? liveData!.months.map((month) => month.label) : months;
  const chartRevenue = hasLiveData ? liveData!.months.map((month) => month.netSales) : revenue;
  const chartProfit = hasLiveData ? liveData!.months.map((month) => month.grossSales) : profit;
  const chartSpend = hasLiveData ? liveData!.months.map((month) => month.shippingRevenue) : spend;
  const chartMaximum = Math.max(...chartRevenue, ...chartProfit, ...chartSpend, 1);
  const exportOverview = () => {
    if (!liveData?.hasData) return;
    downloadCsv("shopify-overview.csv", [
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

  return <>
    {loading ? <div className="data-loading">Loading your Shopify summary…</div> : !hasLiveData && liveData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to start your live dashboard</strong><span>The figures below are a preview. Your own sales and orders will appear after the first sync.</span></div></div> : null}{liveData?.currencyCoverage.excludedOrders ? <div className="connection-notice"><Info/><div><strong>{liveData.currencyCoverage.excludedOrders.toLocaleString()} orders excluded from financial totals</strong><span>Reporting currency is {liveData.currency}. Excluded: {liveData.currencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}. Add explicit exchange rates before consolidating these orders.</span></div></div> : null}
    {hasLiveData ? <div className="report-export"><button className="export-button" onClick={exportOverview}><Download/> Export overview CSV</button></div> : null}
    <section className="metric-grid">{liveMetrics.map((metric) => <article className="metric-card" key={metric.label}>
      <div className="metric-head"><span>{metric.label}</span><CircleDollarSign /></div>
      <strong>{metric.value}</strong>
      <div className="metric-foot"><Trend positive={metric.positive}>{metric.delta}</Trend><span>{metric.hint}</span></div>
    </article>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><span className="eyebrow">PERFORMANCE</span><h2>{hasLiveData ? "Shopify sales trend" : "Revenue & profit trend"}</h2></div><div className="legend"><span className="blue-dot"/>{hasLiveData ? "Net sales" : "Revenue"} <span className="green-dot"/>{hasLiveData ? "Gross sales" : "Net profit"} <span className="orange-dot"/>{hasLiveData ? "Shipping revenue" : "Ad spend"}</div></div>
        <div className="chart-wrap"><div className="y-axis"><span>{hasLiveData ? formatter.format(chartMaximum) : "£300k"}</span><span>{hasLiveData ? formatter.format(chartMaximum / 2) : "£200k"}</span><span>{hasLiveData ? formatter.format(chartMaximum / 4) : "£100k"}</span><span>£0</span></div><div className="bar-chart">{chartMonths.map((month, index) => <div className="bar-group" key={`${month}-${index}`}><div className="bars"><i className="revenue" style={{height:`${(chartRevenue[index] / chartMaximum) * 100}%`}}/><i className="profit" style={{height:`${(chartProfit[index] / chartMaximum) * 100}%`}}/><i className="spend" style={{height:`${(chartSpend[index] / chartMaximum) * 100}%`}}/></div><span>{month}</span></div>)}</div></div>
      </article>
      <article className="panel health-panel"><div className="panel-head"><div><span className="eyebrow">DATA HEALTH</span><h2>{hasLiveData ? "Imported store data" : "Store readiness"}</h2></div><span className="score">{hasLiveData ? "LIVE" : "86%"}</span></div>
        <div className="health-ring"><div><strong>{hasLiveData ? liveData!.metrics.orders.toLocaleString() : "86"}</strong><span>{hasLiveData ? "orders" : "Good"}</span></div></div>
        {hasLiveData ? <ul className="health-list"><li><span className="status success"/>Shopify orders imported <b>{liveData!.metrics.orders.toLocaleString()}</b></li><li><span className="status success"/>Data window <b>{liveData!.range.start} – {liveData!.range.end}</b></li><li><span className={liveData!.meta?.importedDays ? "status success" : "status warn"}/>Marketing spend <b>{liveData!.meta?.importedDays ? `${liveData!.meta.importedDays.toLocaleString()} Meta days · ${liveData!.meta.start} – ${liveData!.meta.end}` : "Not connected"}</b></li></ul> : <ul className="health-list"><li><span className="status success"/>Shopify synced <b>2m ago</b></li><li><span className="status success"/>Ad accounts connected <b>2 of 2</b></li><li><span className="status warn"/>Missing product costs <b>14 SKUs</b></li></ul>}
      </article>
      <article className="panel channel-panel"><div className="panel-head"><div><span className="eyebrow">ACQUISITION</span><h2>Channel performance</h2></div><button className="text-button">View UTM report <ArrowUpRight/></button></div>
        {hasLiveData ? <div className="cost-empty"><Megaphone/><strong>Attribution is ready in the UTM report</strong><span>Connect campaign spend before Spine can calculate ROAS and channel cost.</span></div> : <div className="channel-table"><div className="channel-row header"><span>Channel</span><span>Spend</span><span>Shopify revenue</span><span>ROAS</span><span>Revenue mix</span></div>{channels.map(channel => <div className="channel-row" key={channel.name}><span className="channel-name"><i style={{background:channel.color}}/>{channel.name}</span><span>{channel.spend}</span><strong>{channel.revenue}</strong><span>{channel.roas}</span><span className="mix"><i style={{width:`${channel.share}%`, background:channel.color}}/></span></div>)}</div>}
      </article>
      <article className="panel activity-panel"><div className="panel-head"><div><span className="eyebrow">NEXT STEPS</span><h2>{hasLiveData ? "Complete your profit picture" : "Profit opportunities"}</h2></div></div>
        {hasLiveData ? <><div className="opportunity"><span className="opp-icon purple"><WalletCards/></span><div><strong>Add effective-dated product costs</strong><p>Product profitability becomes more precise as cost coverage improves.</p></div></div><div className="opportunity"><span className="opp-icon green"><Megaphone/></span><div><strong>Review your UTM analysis</strong><p>See the sources, mediums, and campaigns attached to imported orders.</p></div></div><div className="opportunity"><span className="opp-icon orange"><CircleDollarSign/></span><div><strong>Connect marketing spend</strong><p>ROAS and final net profit need trusted campaign spend and merchant shipping costs.</p></div></div></> : <><div className="opportunity"><span className="opp-icon purple"><Sparkles/></span><div><strong>14 products need costs</strong><p>£8,420 revenue has unknown margin.</p></div><button>Add costs</button></div><div className="opportunity"><span className="opp-icon green"><TrendingUp/></span><div><strong>Google Brand is outperforming</strong><p>ROAS improved 22% this period.</p></div><button>Explore</button></div><div className="opportunity"><span className="opp-icon orange"><Megaphone/></span><div><strong>Campaign naming mismatch</strong><p>3 campaigns need UTM mapping.</p></div><button>Fix</button></div></>}
      </article>
    </section>
  </>;
}

type PnlData = {
  hasData: boolean;
  currency: string;
  currencyCoverage: CurrencyCoverage;
  metrics: { grossSales: number; discounts: number; refunds: number; netProductSales: number; shippingRevenue: number; tax: number; duties: number; totalSales: number; cogs: number; grossProfit: number; grossMargin: number | null; marketingSpend: number; transactionFees: number; merchantShippingCosts: number; variantShippingCosts: number; shippingFallbackCosts: number; handlingCosts: number; fixedOperatingExpenses: number; variableOperatingExpenses: number; operatingExpenses: number; contributionMarginBeforeShipping: number; contributionMarginBeforeShippingPercentage: number | null; contributionMargin: number; contributionMarginPercentage: number | null; profitAfterOperatingCosts: number; profitAfterKnownCosts: number; profitAfterMarketingSpend: number; netProfit: number | null; netMargin: number | null; orders: number; missingCostLines: number; missingShippingLines: number; shippingOverrideLines: number; shippingFallbackLines: number; shippingFallbackRate: number | null; unallocatedOperatingCosts: number };
  availability: { marketingSpend: boolean; transactionFees: boolean; shippingCosts: boolean; handlingCosts: boolean; operatingExpenses: boolean; netProfit: boolean };
  period: { start: string; end: string } | null;
};
type PnlPeriodData = { period: ReportingPeriod; data: PnlData };
type PnlRow = { section: string; label: string; value: (data: PnlData) => string };

function ProfitLoss({ savedPreset, reportRunId }: { savedPreset?: "all_imported" | "latest_30_days" | "latest_90_days"; reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [comparison, setComparison] = useState<PnlData | null>(null);
  const [yearComparison, setYearComparison] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [granularity, setGranularity] = useState<ReportingGranularity>("monthly");
  const [periodData, setPeriodData] = useState<PnlPeriodData[]>([]);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "chart">("table");
  const [showComparison, setShowComparison] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const appliedSavedPreset = useRef<string | null>(null);
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
          fetch(`/api/analytics/pnl?from=${date(previousStart)}&to=${date(previousEnd)}`),
          fetch(`/api/analytics/pnl?from=${date(previousYearStart)}&to=${date(previousYearEnd)}`),
        ]);
        if (previousResponse.ok) setComparison(await previousResponse.json() as PnlData);
        if (previousYearResponse.ok) setYearComparison(await previousYearResponse.json() as PnlData);
      })
      .catch(() => { setPnl(null); setComparison(null); setYearComparison(null); finishReportRun("failed", null, "Profit and loss data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, finishReportRun]);

  useEffect(() => {
    if (!savedPreset || !pnl?.period?.end || appliedSavedPreset.current === savedPreset) return;
    appliedSavedPreset.current = savedPreset;
    const periodEnd = pnl.period.end;
    const timeout = window.setTimeout(() => {
      if (savedPreset === "all_imported") { setFromDate(""); setToDate(""); return; }
      const days = savedPreset === "latest_30_days" ? 30 : 90;
      const end = new Date(`${periodEnd}T00:00:00Z`);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
      setFromDate(start.toISOString().slice(0, 10)); setToDate(periodEnd);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [savedPreset, pnl?.period?.end]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!pnl?.period || !pnl.hasData) { setPeriodData([]); return; }
      const periods = reportingPeriods(pnl.period.start, pnl.period.end, granularity, 12);
      setPeriodLoading(true);
      Promise.all(periods.map(async (period) => {
        if (period.start === pnl.period?.start && period.end === pnl.period?.end) return { period, data: pnl };
        const response = await fetch("/api/analytics/pnl?from=" + period.start + "&to=" + period.end, { signal: controller.signal });
        return response.ok ? { period, data: await response.json() as PnlData } : null;
      })).then((results) => setPeriodData(results.filter((result): result is PnlPeriodData => result !== null))).catch((error) => { if (error instanceof Error && error.name !== "AbortError") setPeriodData([]); }).finally(() => { if (!controller.signal.aborted) setPeriodLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [granularity, pnl]);

  const hasLiveData = Boolean(pnl?.hasData);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: pnl?.currency || "GBP", maximumFractionDigits: 0 });
  const signed = (amount: number) => amount < 0 ? `-${formatter.format(Math.abs(amount))}` : formatter.format(amount);
  const demoRows = [["Gross sales","£279,402","£264,128","£251,930","£287,690","£416,007","£258,592"],["Discounts","-£18,204","-£16,770","-£15,204","-£17,620","-£24,341","-£14,740"],["Returns","-£7,812","-£9,133","-£8,390","-£9,218","-£12,451","-£7,270"],["Net sales","£253,386","£238,225","£228,336","£260,852","£379,215","£236,582"],["COGS","-£106,680","-£102,498","-£99,852","-£97,781","-£151,909","-£93,095"],["Gross profit","£146,706","£135,727","£128,484","£163,071","£227,306","£143,487"],["Marketing","-£23,658","-£27,062","-£30,174","-£34,655","-£39,826","-£27,911"],["Transaction & shipping","-£18,405","-£17,909","-£18,175","-£21,104","-£30,676","-£22,659"],["Net profit","£104,643","£90,756","£80,135","£107,312","£156,804","£92,917"]];
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
    ["Meta Ads marketing spend", pnl.availability.marketingSpend ? signed(-pnl.metrics.marketingSpend) : "Not imported"],
    ["Contribution margin before shipping", pnl.availability.marketingSpend ? signed(pnl.metrics.contributionMarginBeforeShipping) : "Import Meta spend to calculate"],
    ["Profit after marketing spend", pnl.availability.marketingSpend ? signed(pnl.metrics.profitAfterMarketingSpend) : "Import Meta spend to calculate"],
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
    { section: "Marketing", label: "Meta Ads marketing spend", value: (data) => data.availability.marketingSpend ? signed(-data.metrics.marketingSpend) : "Not imported" },
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
    ["PROFIT AFTER MARKETING", pnl.availability.marketingSpend ? formatter.format(pnl.metrics.profitAfterMarketingSpend) : "—", pnl.availability.marketingSpend ? "Meta Ads spend included" : "Import Meta Ads spend"],
    ["CONTRIBUTION MARGIN", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? formatter.format(pnl.metrics.contributionMargin) : pnl.availability.marketingSpend ? formatter.format(pnl.metrics.contributionMarginBeforeShipping) : "—", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? `${pnl.metrics.contributionMarginPercentage === null ? "—" : `${(pnl.metrics.contributionMarginPercentage * 100).toFixed(1)}%`} after shipping and handling` : pnl.availability.marketingSpend ? `${pnl.metrics.contributionMarginBeforeShippingPercentage === null ? "—" : `${(pnl.metrics.contributionMarginBeforeShippingPercentage * 100).toFixed(1)}%`} before shipping and handling` : "Import Meta Ads spend"],
  ] : [["NET SALES", "£236,582", "+11.2%"], ["GROSS PROFIT", "£143,487", "+9.4%"], ["MARKETING", "£27,911", "+4.1%"], ["NET PROFIT", "£92,917", "+18.2%"]];
  const totalRows = hasLiveData ? new Set([3, 5, 9, 13, 14, 16, 17, 20, 22, 23]) : new Set([3, 5, 8]);
  const reconciliationIssues = pnl ? [
    pnl.metrics.missingCostLines > 0 ? `${pnl.metrics.missingCostLines.toLocaleString()} product lines need costs` : null,
    pnl.metrics.missingShippingLines > 0 ? `${pnl.metrics.missingShippingLines.toLocaleString()} product lines need shipping costs` : null,
    !pnl.availability.handlingCosts ? "handling or pick/pack costs are missing" : null,
    !pnl.availability.marketingSpend ? "marketing spend is not imported" : null,
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
      ["Generated at", new Date().toISOString()],
      [],
      ["Metric", ...displayedColumns.map((column) => column.period.label)],
      ...visibleRows,
    ]);
  };

  const applyLatestDays = (days: number) => {
    const end = pnl?.period?.end;
    if (!end) return;
    const last = new Date(`${end}T00:00:00Z`);
    const first = new Date(last); first.setUTCDate(first.getUTCDate() - days + 1);
    setFromDate(first.toISOString().slice(0, 10)); setToDate(end);
  };

  const toggleSection = (section: string) => setCollapsedSections((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });

  if (pnl && (viewMode === "table" || viewMode === "chart")) return <>
    <section className="filter-row pnl-period">
      <label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      <select aria-label="P&L granularity" value={granularity} onChange={(event) => setGranularity(event.target.value as ReportingGranularity)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select>
      <div className="segmented"><button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>Table</button><button className={viewMode === "chart" ? "active" : ""} onClick={() => setViewMode("chart")}>Chart</button></div>
      <label className="comparison-toggle"><input type="checkbox" checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)}/> Previous period</label>
      <button disabled={!pnl.period} onClick={() => applyLatestDays(30)}>Latest 30 days</button><button disabled={!pnl.period} onClick={() => applyLatestDays(90)}>Latest 90 days</button>
      {(fromDate || toDate) && <button onClick={() => { setFromDate(""); setToDate(""); }}>All imported data</button>}
    </section>
    {loading || periodLoading ? <div className="data-loading">Calculating reconciled periods…</div> : null}
    {!pnl.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to build your income statement</strong><span>Your period views will populate after the first sync.</span></div></div> : null}{pnl.currencyCoverage.excludedOrders ? <div className="connection-notice"><Info/><div><strong>{pnl.currencyCoverage.excludedOrders.toLocaleString()} orders excluded from this P&amp;L</strong><span>Reporting currency is {pnl.currency}. Excluded: {pnl.currencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}. Spine never combines currencies without an explicit dated exchange rate.</span></div></div> : null}
    {pnl.hasData ? <div className="connection-notice"><Info/><div><strong>{reconciliationIssues.length ? "Reconciliation status: provisional" : "Reconciliation status: complete"}</strong><span>{reconciliationIssues.length ? reconciliationIssues.join(" · ") : "All required cost inputs are covered for this period."}</span></div></div> : null}
    {pnl.hasData ? <><div className="report-export"><button className="export-button" onClick={exportPnl}><Download/> Export visible P&amp;L CSV</button></div><details className="metric-dictionary"><summary>Metric definitions</summary><dl><div><dt>Total sales</dt><dd>Net product sales plus customer shipping revenue. Tax and duties are shown separately.</dd></div><div><dt>Gross profit</dt><dd>Net product sales after refunds, less effective-dated product costs.</dd></div><div><dt>Net profit</dt><dd>Available after marketing, shipping, handling, product-cost, and operating-cost coverage is complete.</dd></div></dl></details></> : null}
    <section className="panel report-panel"><div className="report-summary">{summary.map(([label, value, hint]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
      {viewMode === "chart" && displayPeriods.length ? <div className="pnl-chart"><div className="panel-head"><div><span className="eyebrow">PROFIT TREND</span><h2>Revenue, gross profit, and net profit</h2></div><div className="legend"><span className="blue-dot"/>Net sales <span className="green-dot"/>Gross profit <span className="orange-dot"/>Net profit</div></div><div className="chart-wrap"><div className="y-axis"><span>{formatter.format(chartMaximum)}</span><span>{formatter.format(chartMaximum / 2)}</span><span>{formatter.format(chartMaximum / 4)}</span><span>{formatter.format(0)}</span></div><div className="bar-chart">{displayPeriods.map(({ period, data }) => <div className="bar-group" key={period.start + "-" + period.end}><div className="bars"><i className="revenue" style={{height:(Math.abs(data.metrics.netProductSales - data.metrics.refunds) / chartMaximum * 100) + "%"}}/><i className="profit" style={{height:(Math.abs(data.metrics.grossProfit) / chartMaximum * 100) + "%"}}/><i className="spend" style={{height:(Math.abs(data.metrics.netProfit ?? 0) / chartMaximum * 100) + "%"}}/></div><span>{period.label}</span></div>)}</div></div></div> : null}
      {viewMode === "table" ? <div className="table-scroll"><table className="data-table pnl-table period-table"><thead><tr><th>Income statement</th>{displayedColumns.map((column, index) => <th key={column.period.start + "-" + column.period.end + "-" + index}>{column.period.label}</th>)}</tr></thead><tbody>{sections.map((section) => [<tr className="pnl-section" key={section + "-heading"}><td colSpan={displayedColumns.length + 1}><button onClick={() => toggleSection(section)}><ChevronDown className={collapsedSections.has(section) ? "collapsed" : ""}/>{section}</button></td></tr>, ...(collapsedSections.has(section) ? [] : pnlRows.filter((row) => row.section === section).map((row) => <tr className={row.label.includes("profit") || row.label.includes("margin") || row.label === "Total sales" ? "total" : ""} key={section + "-" + row.label}><td><span className="indent">{row.label}</span></td>{displayedColumns.map((column, index) => <td key={row.label + "-" + index}>{row.value(column.data)}</td>)}</tr>))])}</tbody></table></div> : null}
      <div className="table-footer"><span>{periodData.length >= 12 ? "Showing the latest 12 " + granularity + " periods" : displayPeriods.length + " " + granularity + " period" + (displayPeriods.length === 1 ? "" : "s")}</span><span>{showComparison ? "Previous-period overlay on" : "Comparison overlay off"}</span></div>
    </section>
  </>;

  return <>{comparison?.hasData && pnl?.hasData ? <section className="cost-grid live pnl-comparison"><div><strong>{change(pnl.metrics.netProductSales, comparison.metrics.netProductSales) === null ? "—" : `${change(pnl.metrics.netProductSales, comparison.metrics.netProductSales)!.toFixed(1)}%`}</strong><span>Net product sales vs previous period</span></div><div><strong>{change(pnl.metrics.grossProfit, comparison.metrics.grossProfit) === null ? "—" : `${change(pnl.metrics.grossProfit, comparison.metrics.grossProfit)!.toFixed(1)}%`}</strong><span>Gross profit vs previous period</span></div><div><strong>{pnl.metrics.orders - comparison.metrics.orders >= 0 ? "+" : ""}{(pnl.metrics.orders - comparison.metrics.orders).toLocaleString()}</strong><span>Orders vs previous period</span></div></section> : null}{yearComparison?.hasData && pnl?.hasData ? <section className="cost-grid live pnl-comparison"><div><strong>{change(pnl.metrics.netProductSales, yearComparison.metrics.netProductSales) === null ? "—" : `${change(pnl.metrics.netProductSales, yearComparison.metrics.netProductSales)!.toFixed(1)}%`}</strong><span>Net product sales vs previous year</span></div><div><strong>{change(pnl.metrics.grossProfit, yearComparison.metrics.grossProfit) === null ? "—" : `${change(pnl.metrics.grossProfit, yearComparison.metrics.grossProfit)!.toFixed(1)}%`}</strong><span>Gross profit vs previous year</span></div><div><strong>{pnl.metrics.orders - yearComparison.metrics.orders >= 0 ? "+" : ""}{(pnl.metrics.orders - yearComparison.metrics.orders).toLocaleString()}</strong><span>Orders vs previous year</span></div></section> : null}<section className="filter-row pnl-period"><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button disabled={!pnl?.period} onClick={() => applyLatestDays(30)}>Latest 30 days</button><button disabled={!pnl?.period} onClick={() => applyLatestDays(90)}>Latest 90 days</button>{(fromDate || toDate) && <button onClick={() => { setFromDate(""); setToDate(""); }}>All imported data</button>}</section>{loading ? <div className="data-loading">Calculating your income statement…</div> : !hasLiveData && pnl ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to build your income statement</strong><span>The preview will be replaced with reconciled sales and cost data after your first sync.</span></div></div> : null}{hasLiveData ? <div className="connection-notice"><Info/><div><strong>How this P&amp;L is calculated</strong><span>Total sales are net product sales plus shipping revenue. Gross profit is Shopify net product sales, less refunds and effective-dated product costs. Tax and duties are shown for reconciliation but excluded from profit. Operating expenses include your fixed, per-order, per-unit, and revenue-rate rules. Actual Shopify payment fees take priority; matching gateway rules estimate missing fees. Imported Meta Ads spend is deducted when it overlaps the selected period. Fulfilment, handling, and pick/pack rules provide the remaining direct costs.</span></div></div> : null}{hasLiveData && pnl!.metrics.missingCostLines > 0 ? <div className="connection-notice"><Info/><div><strong>{pnl!.metrics.missingCostLines} order lines are missing a product cost</strong><span>Gross profit is provisional until you add an effective-dated product cost for these variants.</span></div></div> : null}{hasLiveData && pnl!.metrics.unallocatedOperatingCosts > 0 ? <div className="connection-notice"><Info/><div><strong>{pnl!.metrics.unallocatedOperatingCosts} operating costs still need an allocation rule</strong><span>The P&amp;L excludes these costs because their currency or effective dates need attention.</span></div></div> : null}{hasLiveData ? <><div className="report-export"><button className="export-button" onClick={exportPnl}><Download/> Export P&amp;L CSV</button></div><details className="metric-dictionary"><summary>Metric definitions</summary><dl><div><dt>Total sales</dt><dd>Net product sales plus customer shipping revenue. Tax and duties are shown separately.</dd></div><div><dt>Gross profit</dt><dd>Net product sales after refunds, less effective-dated product costs. It is marked provisional when a line has no cost.</dd></div><div><dt>Profit after known costs</dt><dd>Gross profit less payment fees, merchant shipping, handling, pick/pack, fixed operating costs, and variable operating costs available to Spine.</dd></div><div><dt>Profit after marketing spend</dt><dd>Profit after known costs less imported Meta Ads spend in the selected period.</dd></div><div><dt>Net profit</dt><dd>Available only after marketing, merchant shipping, handling, product costs, and operating-cost coverage are complete.</dd></div></dl></details></> : null}<section className="panel report-panel"><div className="report-summary">{summary.map(([label, value, hint])=><div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div><div className="table-scroll"><table className="data-table pnl-table"><thead><tr><th>Income statement</th><th>{hasLiveData ? pnl?.period ? `${pnl.period.start} to ${pnl.period.end}` : "Selected period" : "Apr 2026"}</th>{!hasLiveData&&months.slice(1).map(month=><th key={month}>{month} 2026</th>)}</tr></thead><tbody>{liveRows.map((row,index)=><tr className={totalRows.has(index)?"total":""} key={row[0]}>{row.map((cell,i)=><td key={`${cell}-${i}`}>{i===0 && !totalRows.has(index)?<span className="indent">{cell}</span>:cell}</td>)}</tr>)}</tbody></table></div></section></>;
}

type UtmRow = { channel: string; source: string; medium: string; campaign: string; content: string; term: string; landingPage: string; customerType: string; sales: number; orders: number; customers: number; newCustomerSales: number; averageOrderValue: number; revenuePerCustomer: number | null };
type UtmData = { hasData: boolean; currency: string; attributionModel: "first_touch" | "last_touch"; period: { start: string; end: string } | null; totals: { sales: number; orders: number; attributedOrders: number; customers: number; newCustomerSales: number; averageOrderValue: number; revenuePerCustomer: number | null }; diagnostics: { missingAttribution: { orders: number; sales: number }; missingUtm: { orders: number; sales: number }; missingLandingPage: { orders: number; sales: number }; missingReferrer: { orders: number; sales: number } }; trends: Array<{ period: string; sales: number; orders: number; customers: number; newCustomerSales: number }>; rows: UtmRow[] };

function UTMAnalysis({ reportRunId }: { reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<UtmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [medium, setMedium] = useState("all");
  const [campaign, setCampaign] = useState("all");
  const [landingPage, setLandingPage] = useState("all");
  const [customerType, setCustomerType] = useState("all");
  const [attributionModel, setAttributionModel] = useState<"first_touch" | "last_touch">("last_touch");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ attribution: attributionModel });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`/api/analytics/utm?${params}`).then(async (response) => response.ok ? response.json() : null).then((payload: UtmData | null) => { setData(payload); finishReportRun(payload ? "completed" : "failed", payload?.rows.length ?? null); }).catch(() => { setData(null); finishReportRun("failed", null, "UTM data could not be loaded"); }).finally(() => setLoading(false));
  }, [attributionModel, fromDate, toDate, finishReportRun]);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const metrics = data ? [["Net sales", formatter.format(data.totals.sales), `${data.rows.length.toLocaleString()} normalized groups`], ["Attributed orders", data.totals.attributedOrders.toLocaleString(), `${data.totals.orders.toLocaleString()} valid orders total`], ["New-customer sales", formatter.format(data.totals.newCustomerSales), attributionModel === "last_touch" ? "Last-touch customer journey" : "First-touch customer journey"], ["Average order value", formatter.format(data.totals.averageOrderValue), `${data.totals.customers.toLocaleString()} identified customers`], ["Revenue per customer", data.totals.revenuePerCustomer === null ? "—" : formatter.format(data.totals.revenuePerCustomer), "Identified customers only"], ["Profit and ROAS", "—", "Available after campaign spend mapping"]] : [["Net sales", "£204,050", "79% of net sales"], ["Attributed orders", "319", "All valid orders shown"], ["New customer sales", "£146,920", "72% of attributed"], ["Average order value", "£640", "Across valid orders"], ["Revenue per customer", "£820", "Identified customers"], ["Profit and ROAS", "—", "Map campaign spend"]];
  const rows = data?.hasData ? data.rows : utms.map(([source, medium, campaign, sales, orders, aov]) => ({ channel: "Attributed", source, medium, campaign, content: "—", term: "—", landingPage: "Unknown", customerType: "New", sales: Number(String(sales).replace(/[^0-9.-]/g, "")), orders: Number(orders), customers: Number(orders), newCustomerSales: 0, averageOrderValue: Number(aov.replace(/[^0-9]/g, "")), revenuePerCustomer: null }));
  const sources = [...new Set(rows.map((row) => row.source || "Unknown"))].sort();
  const mediums = [...new Set(rows.map((row) => row.medium || "Unknown"))].sort();
  const campaigns = [...new Set(rows.map((row) => row.campaign || "Unknown"))].sort();
  const landingPages = [...new Set(rows.map((row) => row.landingPage))].sort();
  const customerTypes = [...new Set(rows.map((row) => row.customerType))].sort();
  const visibleRows = rows.filter((row) => `${row.channel} ${row.source} ${row.medium} ${row.campaign} ${row.content} ${row.term} ${row.landingPage}`.toLowerCase().includes(search.trim().toLowerCase()) && (source === "all" || row.source === source) && (medium === "all" || row.medium === medium) && (campaign === "all" || row.campaign === campaign) && (landingPage === "all" || row.landingPage === landingPage) && (customerType === "all" || row.customerType === customerType));
  const trendMaximum = Math.max(...(data?.trends.map((trend) => trend.sales) ?? []), 1);
  const exportUtm = () => downloadCsv("utm-analysis.csv", [["Report", "UTM analysis"], ["Attribution model", attributionModel === "last_touch" ? "Last touch" : "First touch"], ["Period", data?.period ? `${data.period.start} to ${data.period.end}` : "No imported orders"], ["Currency", data?.currency || "GBP"], ["Generated at", new Date().toISOString()], [], ["Channel", "Source", "Medium", "Campaign", "Content", "Term", "Landing page", "Customer type", "Net sales", "Orders", "Customers", "Average order value", "Revenue per customer", "New-customer sales"], ...visibleRows.map((row) => [row.channel, row.source, row.medium, row.campaign, row.content, row.term, row.landingPage, row.customerType, row.sales, row.orders, row.customers, row.averageOrderValue, row.revenuePerCustomer ?? "", row.newCustomerSales])]);
  const diagnosticItems = data ? [["No attribution record", data.diagnostics.missingAttribution], ["No UTM parameters", data.diagnostics.missingUtm], ["No landing page", data.diagnostics.missingLandingPage], ["No referrer", data.diagnostics.missingReferrer]] as const : [];
  return <>
    {loading ? <div className="data-loading">Loading Shopify attribution…</div> : data && !data.hasData ? <div className="connection-notice"><Info/><div><strong>Shopify attribution will appear after an order sync</strong><span>This report uses the selected Shopify customer journey model.</span></div></div> : null}
    <section className="metric-grid compact">{metrics.map(([label, value, hint]) => <article className="metric-card" key={label}><div className="metric-head"><span>{label}</span></div><strong>{value}</strong><div className="metric-foot"><span>{hint}</span></div></article>)}</section>
    {data?.trends.length ? <section className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">MONTHLY TREND</span><h2>Sales and new-customer sales</h2></div><div className="legend"><span className="blue-dot"/>Net sales <span className="green-dot"/>New-customer sales</div></div><div className="chart-wrap"><div className="y-axis"><span>{formatter.format(trendMaximum)}</span><span>{formatter.format(trendMaximum / 2)}</span><span>{formatter.format(trendMaximum / 4)}</span><span>{formatter.format(0)}</span></div><div className="bar-chart">{data.trends.map((trend) => <div className="bar-group" key={trend.period} title={`${trend.orders.toLocaleString()} orders · ${trend.customers.toLocaleString()} customers`}><div className="bars"><i className="revenue" style={{height:`${trend.sales / trendMaximum * 100}%`}}/><i className="profit" style={{height:`${trend.newCustomerSales / trendMaximum * 100}%`}}/></div><span>{trend.period}</span></div>)}</div></div></section> : null}
    {data && diagnosticItems.some(([, diagnostic]) => diagnostic.orders > 0) ? <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">ATTRIBUTION COVERAGE</span><h2>Unattributed-sales diagnostic</h2></div><span className="report-note">An order can appear in more than one gap when Shopify did not record several journey fields.</span></div><div className="report-summary">{diagnosticItems.map(([label, diagnostic]) => <div key={label}><span>{label}</span><strong>{diagnostic.orders.toLocaleString()} orders</strong><small>{formatter.format(diagnostic.sales)} net sales</small></div>)}</div></section> : null}
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">{attributionModel === "last_touch" ? "LAST-TOUCH ATTRIBUTION" : "FIRST-TOUCH ATTRIBUTION"}</span><h2>Sales by UTM</h2></div><div className="feature-actions"><span className="report-note">{attributionModel === "last_touch" ? "Each order is represented once by its final Shopify-tracked visit." : "Each order is represented once by its first Shopify-tracked visit."}</span><button className="export-button" disabled={!rows.length} onClick={exportUtm}><Download/> Export CSV</button></div></div>
      <div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search UTM dimensions..."/></div><select aria-label="UTM source" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="UTM medium" value={medium} onChange={(event) => setMedium(event.target.value)}><option value="all">All media</option>{mediums.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="UTM campaign" value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Landing page" value={landingPage} onChange={(event) => setLandingPage(event.target.value)}><option value="all">All landing pages</option>{landingPages.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Customer type" value={customerType} onChange={(event) => setCustomerType(event.target.value)}><option value="all">All customers</option>{customerTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Attribution model" value={attributionModel} onChange={(event) => setAttributionModel(event.target.value as "first_touch" | "last_touch")}><option value="last_touch">Last-touch attribution</option><option value="first_touch">First-touch attribution</option></select><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)}/></label><label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)}/></label>{(fromDate || toDate) && <button onClick={() => { setFromDate(""); setToDate(""); }}>All imported data</button>}</div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Channel</th><th>Source</th><th>Medium</th><th>Campaign</th><th>Content</th><th>Term</th><th>Landing page</th><th>Customer type</th><th>Net sales</th><th>Orders</th><th>Customers</th><th>AOV</th><th>Revenue/customer</th><th>New-customer sales</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={`${row.channel}-${row.source}-${row.medium}-${row.campaign}-${row.content}-${row.term}-${row.landingPage}-${row.customerType}`}><td>{row.channel}</td><td><span className="utm-source"><i/>{row.source}</span></td><td>{row.medium}</td><td>{row.campaign}</td><td>{row.content}</td><td>{row.term}</td><td>{row.landingPage}</td><td>{row.customerType}</td><td><strong>{formatter.format(Number(row.sales))}</strong></td><td>{row.orders.toLocaleString()}</td><td>{row.customers.toLocaleString()}</td><td>{formatter.format(row.averageOrderValue)}</td><td>{row.revenuePerCustomer === null ? "—" : formatter.format(row.revenuePerCustomer)}</td><td>{formatter.format(row.newCustomerSales)}</td></tr>) : <tr><td colSpan={14} className="empty-row">No UTM groups match that filter.</td></tr>}</tbody></table></div>
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
    });
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
  const coverage = variants.length ? Math.round((covered / variants.length) * 100) : 0;
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });

  return <>
    <section className="cost-toolbar">
      <div><span className="eyebrow">COST ENGINE</span><h2>Product cost history</h2><p>Costs apply from their effective date, so future changes do not rewrite historical profit.</p></div>
      <div className="feature-actions"><button className="primary" disabled={!canEdit} onClick={()=>setShowAdd(true)}><Plus/> Add product cost</button><button disabled={!canEdit} onClick={() => setShowAddShipping(true)}><Plus/> Add shipping override</button><label className={canEdit?"csv-button":"csv-button disabled"}><Upload/> Import CSV<input type="file" accept=".csv,text/csv" disabled={!canEdit || saving} onChange={(event)=>{const file=event.target.files?.[0];if(file) void importCsv(file);event.target.value="";}}/></label></div>
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

function Connections() {
  const [showMetaSetup, setShowMetaSetup] = useState(false);
  const [showShopifySetup, setShowShopifySetup] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [metaLookbackMonths, setMetaLookbackMonths] = useState("12");
  const [metaConnected, setMetaConnected] = useState(false);
  const [klaviyoConnected, setKlaviyoConnected] = useState(false);
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
        setAccountId(payload.connection.external_account_id ?? "");
        setMetaAccountName(payload.connection.external_account_name ?? "");
        setMetaLastSync(payload.sync ?? null);
      })
      .catch(() => undefined);
    fetch("/api/connections/klaviyo").then((response) => response.ok ? response.json() : null).then((payload) => setKlaviyoConnected(payload?.connection?.status === "connected")).catch(() => undefined);
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

  const saveMeta = async () => {
    if (!token.trim()) return;
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
    setToken(""); setAccountId(""); setMetaAccountName(""); setMetaSyncResult(""); setMetaLastSync(null); setMetaConnected(false); setShowMetaSetup(false);
  };

  const disconnectShopify = async () => {
    setSavingConnection(true); setConnectionError("");
    const response = await fetch("/api/connections/shopify", { method: "DELETE" });
    setSavingConnection(false);
    if (!response.ok) { const payload = await response.json(); setConnectionError(payload.error ?? "Could not disconnect Shopify"); return; }
    setShopifyConnected(false); setShopifyName(""); setShopifyScopes([]); setShopifyStore(null); setShopifyToken(""); setShopifySyncResult(""); setShopifyLastSync(null); setShowShopifySetup(false);
  };

  const saveShopify = async () => {
    if (!shopDomain.trim() || !shopifyToken.trim()) return;
    setSavingConnection(true); setConnectionError(""); setShopifySyncResult("");
    const response = await fetch("/api/connections/shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopDomain, accessToken: shopifyToken }) });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) { setConnectionError(payload.error ?? "Could not connect Shopify"); return; }
    setShopifyConnected(true); setShopifyName(payload.connection?.external_account_name ?? shopDomain); setShopifyScopes(payload.connection?.granted_scopes ?? []); setShopifyToken("");
    setShopifySyncResult(`${payload.sync?.mode === "incremental" ? "Incremental refresh" : "Historical import"}: ${payload.sync?.products ?? 0} products, ${payload.sync?.variants ?? 0} variants, ${payload.sync?.orders ?? 0} orders and ${payload.sync?.customers ?? 0} customers imported`);
    window.setTimeout(() => window.location.reload(), 750);
  };

  const connectKlaviyo = async () => { const apiKey = window.prompt("Paste your Klaviyo private API key"); if (!apiKey) return; setSavingConnection(true); const response = await fetch("/api/connections/klaviyo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) }); setSavingConnection(false); if (!response.ok) { const payload = await response.json(); setConnectionError(payload.error || "Could not connect Klaviyo"); return; } setKlaviyoConnected(true); };

  const connections = [
    ["Shopify", "Sales, orders, products & customers", shopifyConnected ? "Connected" : "Connect", "S"],
    ["Meta Ads", "Campaign spend & performance", metaConnected ? "Connected" : "Connect", "M"],
    ["Google Ads", "Campaign and keyword reporting", "Coming next", "G"],
    ["Klaviyo", "Campaign and flow analytics", klaviyoConnected ? "Connected" : "Connect", "K"],
  ];

  return <>
    <div className="connection-notice"><Info/><div><strong>Secure connection storage</strong><span>Access tokens are encrypted in Supabase Vault and are never returned to the browser after saving.</span></div></div>
    <section className="connection-grid">{connections.map(([name,desc,status,letter])=><article className="connection-card" key={name}><div className={`source-logo ${letter.toLowerCase()}`}>{letter}</div><div><h3>{name}</h3><p>{desc}</p></div><button disabled={status === "Coming next"} onClick={()=>name === "Meta Ads" ? setShowMetaSetup(true) : name === "Shopify" ? setShowShopifySetup(true) : name === "Klaviyo" && void connectKlaviyo()} className={status==="Connected"?"connected":""}>{status==="Connected"&&<span/>}{status}</button></article>)}</section>
    {showShopifySetup && <div className="modal-backdrop" onMouseDown={()=>setShowShopifySetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowShopifySetup(false)}><X/></button><div className="modal-brand"><div className="source-logo s">S</div><div><span className="eyebrow">PRIMARY SALES SOURCE</span><h2>Connect Shopify</h2></div></div>
      <p className="modal-intro">Connect an Admin API token to validate the store and import catalogue, order, customer, refund and attribution data. Disconnecting removes the encrypted token but preserves your imported reporting data.</p>
      {shopifyConnected && shopifyName && <div className="connected-account"><span/><div><small>CONNECTED STORE</small><strong>{shopifyName}</strong>{shopifyStore && <small>{shopifyStore.shopify_domain || "Shopify store"} · {shopifyStore.currency} · {shopifyStore.timezone || "Timezone unavailable"}</small>}{shopifyScopes.length > 0 && <small>Granted scopes: {shopifyScopes.join(", ")}</small>}</div></div>}{shopifyLastSync && <div className={shopifyLastSync.status === "failed" ? "connection-error" : "connected-account"}><span/>{shopifyLastSync.status === "failed" ? <div><small>LAST IMPORT FAILED</small><strong>{shopifyLastSync.error_message || "Open the token and try again"}</strong></div> : shopifyImportPaused ? <div><small>IMPORT PAUSED AT A SAVED CHECKPOINT</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records saved. Reconnect with the same token to resume.</strong></div> : shopifyLastSync.status === "running" ? <div><small>IMPORT IN PROGRESS</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records saved so far.</strong></div> : <div><small>LAST IMPORT</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records · {shopifyLastSync.completed_at ? new Date(shopifyLastSync.completed_at).toLocaleString("en-GB") : shopifyLastSync.status}</strong></div>}</div>}
      <div className="help-card"><Info/><div><strong>Required access scopes</strong><ol><li>Open your app in Shopify Dev Dashboard.</li><li>Grant <code>read_products</code>, <code>read_inventory</code>, <code>read_orders</code> and <code>read_customers</code>.</li><li>Install or reinstall the app on the store and copy its Admin API token.</li></ol><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">Open Shopify Dev Dashboard <ExternalLink/></a></div></div>
      {shopifyLastSync && <div className="connection-notice"><Info/><div><strong>{shopifyLastSync.sync_mode === "incremental" ? "Rolling incremental refresh" : "Initial historical import"}</strong><span>{shopifyLastSync.pages_processed.toLocaleString()} order pages checkpointed{shopifyLastSync.window_start ? ` · refreshing changes since ${new Date(shopifyLastSync.window_start).toLocaleString("en-GB")}` : " · importing all available history"}</span></div></div>}
      <label className="form-field"><span>Store domain</span><input value={shopDomain} onChange={(event)=>setShopDomain(event.target.value)} placeholder="your-store.myshopify.com"/></label>
      <label className="form-field"><span>Admin API access token <b className="tooltip-trigger">?<em>Use an Admin API token with product, inventory, order and customer read scopes.</em></b></span><div className="secret-input"><KeyRound/><input value={shopifyToken} onChange={(event)=>setShopifyToken(event.target.value)} type={showToken?"text":"password"} placeholder="shpat_..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      {shopifySyncResult && <div className="connected-account"><span/><div><small>CATALOGUE SYNC COMPLETE</small><strong>{shopifySyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{shopifyConnected && <button className="danger-button" disabled={savingConnection} onClick={disconnectShopify}>Disconnect</button>}<button onClick={()=>setShowShopifySetup(false)}>Close</button><button className="primary" disabled={!shopDomain.trim() || !shopifyToken.trim() || savingConnection} onClick={saveShopify}>{savingConnection?"Connecting & importing…":shopifyConnected?"Reconnect & sync":"Connect & import"}</button></div>
    </section></div>}
    {showMetaSetup && <div className="modal-backdrop" onMouseDown={()=>setShowMetaSetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowMetaSetup(false)}><X/></button>
      <div className="modal-brand"><div className="source-logo m">M</div><div><span className="eyebrow">DATA CONNECTION</span><h2>Connect Meta Ads</h2></div></div>
      <p className="modal-intro">Paste a Meta access token from the Graph API Explorer. We&apos;ll verify it against Meta, discover the ad account, securely save the connection, and import daily ad spend for the rolling period you choose. Meta allows a maximum 37-month lookback.</p>
      {metaConnected && metaAccountName && <div className="connected-account"><span/><div><small>CURRENT ACCOUNT</small><strong>{metaAccountName}</strong>{metaLastSync ? <small>{metaLastSync.importedDays.toLocaleString()} daily spend records · latest {metaLastSync.latestDate ? new Date(`${metaLastSync.latestDate}T00:00:00Z`).toLocaleDateString("en-GB") : "date unavailable"}</small> : <small>Spend data has not been imported yet.</small>}</div></div>}
      <div className="help-card"><Info/><div><strong>Where do I find my token?</strong><ol><li>Open Meta&apos;s Graph API Explorer.</li><li>Select your Meta app and user.</li><li>Add <code>ads_read</code> and <code>read_insights</code> permissions.</li><li>Click Generate Access Token, then paste it below.</li></ol><a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Open Graph API Explorer <ExternalLink/></a></div></div>
      <label className="form-field"><span>Access token <b className="tooltip-trigger">?<em>Generate this in Meta Graph API Explorer with ads_read and read_insights permissions.</em></b></span><div className="secret-input"><KeyRound/><input value={token} onChange={(event)=>setToken(event.target.value)} type={showToken?"text":"password"} placeholder="EAAB..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      <label className="form-field"><span>Ad account ID <small>Optional</small></span><input value={accountId} onChange={(event)=>setAccountId(event.target.value)} placeholder="act_123456789"/></label>
      <label className="form-field"><span>Spend history to import</span><select value={metaLookbackMonths} onChange={(event)=>setMetaLookbackMonths(event.target.value)}><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="24">Last 24 months</option><option value="36">Last 36 months</option></select><small>New connections default to the last 365 days. Meta supports up to 37 months when you need more history.</small></label>
      <div className="permission-note"><KeyRound/><span><strong>Required permissions:</strong> ads_read, read_insights</span></div>
      {metaSyncResult && <div className="connected-account"><span/><div><small>SPEND IMPORT COMPLETE</small><strong>{metaSyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{metaConnected&&<button className="danger-button" disabled={savingConnection} onClick={disconnectMeta}>Disconnect</button>}<button onClick={()=>setShowMetaSetup(false)}>Cancel</button><button className="primary" disabled={!token.trim() || savingConnection} onClick={saveMeta}>{savingConnection?"Importing…":metaConnected?"Reconnect & import":"Verify, save & import"}</button></div>
    </section></div>}
  </>;
}

type SalesOrder = { id: string; order_name: string; processed_at: string | null; financial_status: string | null; fulfillment_status: string | null; source_name: string | null; net_product_sales: string; shipping_revenue: string; total_sales: string; currency: string; refunded: number };
type OrderDetail = { currency: string; order: SalesOrder & { gross_sales: string; discounts: string; tax: string; duties: string }; lines: Array<{ id: string; title: string; variant_title: string | null; sku: string | null; current_quantity: number; net_sales: string; unitCost: number | null; cogs: number | null }>; metrics: { refunds: number; cogs: number; grossProfit: number; missingCostLines: number } };

function Sales({ reportRunId }: { reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<{ hasData: boolean; currency: string; orders: SalesOrder[] } | null>(null);
  const [search, setSearch] = useState("");
  const [financialStatus, setFinancialStatus] = useState("all");
  const [fulfilmentStatus, setFulfilmentStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [refundFilter, setRefundFilter] = useState("all");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  useEffect(() => { fetch("/api/analytics/orders").then(async (response) => response.ok ? response.json() : null).then((payload) => { setData(payload); finishReportRun(payload ? "completed" : "failed", payload?.orders?.length ?? null); }).catch(() => { setData(null); finishReportRun("failed", null, "Sales data could not be loaded"); }); }, [finishReportRun]);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: detail?.currency || data?.currency || "GBP", maximumFractionDigits: 2 });
  const orders = data?.orders ?? [];
  const financialStatuses = [...new Set(orders.map((order) => order.financial_status || "Unknown"))].sort();
  const fulfilmentStatuses = [...new Set(orders.map((order) => order.fulfillment_status || "Unknown"))].sort();
  const sources = [...new Set(orders.map((order) => order.source_name || "Unknown"))].sort();
  const visibleOrders = orders.filter((order) => `${order.order_name} ${order.financial_status ?? ""} ${order.fulfillment_status ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (financialStatus === "all" || (order.financial_status || "Unknown") === financialStatus) && (fulfilmentStatus === "all" || (order.fulfillment_status || "Unknown") === fulfilmentStatus) && (source === "all" || (order.source_name || "Unknown") === source) && (refundFilter === "all" || refundFilter === "refunded" && order.refunded > 0 || refundFilter === "not-refunded" && order.refunded === 0));
  const exportSales = () => downloadCsv("shopify-orders.csv", [["Report", "Sales orders"], ["Currency", data?.currency || "GBP"], ["Generated at", new Date().toISOString()], ["Filters", [financialStatus, fulfilmentStatus, source, refundFilter].filter((value) => value !== "all").join(", ") || "None"], [], ["Order", "Date", "Financial status", "Fulfilment status", "Source", "Product sales", "Refunds", "Shipping", "Total"], ...visibleOrders.map((order) => [order.order_name, order.processed_at || "", order.financial_status || "", order.fulfillment_status || "", order.source_name || "", Number(order.net_product_sales), order.refunded, Number(order.shipping_revenue), Number(order.total_sales)])]);
  const openDetail = async (id: string) => { setDetail(null); setDetailError(""); setDetailLoading(true); try { const response = await fetch(`/api/analytics/orders/${encodeURIComponent(id)}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load order"); setDetail(payload); } catch (reason) { setDetailError(reason instanceof Error ? reason.message : "Could not load order"); } finally { setDetailLoading(false); } };
  return <><section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">SHOPIFY ORDERS</span><h2>Sales and orders</h2></div><div className="feature-actions"><span className="report-note">Most recent 250 imported orders</span><button className="export-button" disabled={!visibleOrders.length} onClick={exportSales}><Download/> Export CSV</button></div></div><div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders or status..."/></div><select aria-label="Financial status" value={financialStatus} onChange={(event) => setFinancialStatus(event.target.value)}><option value="all">All payments</option>{financialStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Fulfilment status" value={fulfilmentStatus} onChange={(event) => setFulfilmentStatus(event.target.value)}><option value="all">All fulfilment</option>{fulfilmentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Sales source" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Refund status" value={refundFilter} onChange={(event) => setRefundFilter(event.target.value)}><option value="all">All refund states</option><option value="refunded">Refunded</option><option value="not-refunded">Not refunded</option></select></div>{data && !data.hasData ? <div className="cost-empty"><ShoppingBag/><strong>No Shopify orders yet</strong><span>Connect Shopify and run the first sync to populate sales.</span></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Date</th><th>Financial status</th><th>Fulfilment</th><th>Source</th><th>Product sales</th><th>Refunds</th><th>Shipping</th><th>Total</th></tr></thead><tbody>{!data ? <tr><td colSpan={9} className="empty-row">Loading orders…</td></tr> : visibleOrders.length === 0 ? <tr><td colSpan={9} className="empty-row">No orders match that search.</td></tr> : visibleOrders.map((order) => <tr key={order.id}><td><button className="table-link" onClick={() => void openDetail(order.id)}><strong>{order.order_name}</strong></button></td><td>{order.processed_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(order.processed_at)) : "—"}</td><td>{order.financial_status || "—"}</td><td>{order.fulfillment_status || "—"}</td><td>{order.source_name || "—"}</td><td>{formatter.format(Number(order.net_product_sales))}</td><td>{order.refunded ? formatter.format(-order.refunded) : "—"}</td><td>{formatter.format(Number(order.shipping_revenue))}</td><td><strong>{formatter.format(Number(order.total_sales))}</strong></td></tr>)}</tbody></table></div>}</section>{(detailLoading || detail || detailError) && <div className="modal-backdrop" onMouseDown={() => { if (!detailLoading) { setDetail(null); setDetailError(""); } }}><section className="connection-modal order-drawer" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" disabled={detailLoading} onClick={() => { setDetail(null); setDetailError(""); }}><X/></button>{detailLoading ? <div className="data-loading">Loading order details…</div> : detailError ? <div className="connection-error">{detailError}</div> : detail && <><div className="modal-brand"><span className="source-logo s"><ShoppingBag/></span><div><span className="eyebrow">ORDER PROFITABILITY</span><h2>{detail.order.order_name}</h2></div></div><div className="order-detail-grid"><div><span>Product sales</span><strong>{formatter.format(Number(detail.order.net_product_sales))}</strong></div><div><span>Refunds</span><strong>{formatter.format(-detail.metrics.refunds)}</strong></div><div><span>Product COGS</span><strong>{detail.metrics.missingCostLines ? "Partial" : formatter.format(-detail.metrics.cogs)}</strong></div><div><span>Gross profit</span><strong>{detail.metrics.missingCostLines ? "Coverage needed" : formatter.format(detail.metrics.grossProfit)}</strong></div></div>{detail.metrics.missingCostLines > 0 && <div className="connection-notice"><Info/><div><strong>{detail.metrics.missingCostLines} line items are missing a cost</strong><span>Gross profit is incomplete until effective-dated product costs are added.</span></div></div>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Line item</th><th>SKU</th><th>Qty</th><th>Net sales</th><th>Unit cost</th><th>COGS</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td><strong>{line.title}</strong><small>{line.variant_title || ""}</small></td><td>{line.sku || "—"}</td><td>{line.current_quantity}</td><td>{formatter.format(Number(line.net_sales))}</td><td>{line.unitCost === null ? "Missing" : formatter.format(line.unitCost)}</td><td>{line.cogs === null ? "Missing" : formatter.format(line.cogs)}</td></tr>)}</tbody></table></div></>}</section></div>}</>;
}

type ProductProfit = { key: string; product: string; variant: string; sku: string | null; units: number; revenue: number; discounts: number; refunds: number; netRevenue: number; cogs: number; grossProfit: number; margin: number | null; missingCostUnits: number; shippingCosts: number; handlingCosts: number; transactionFeeAllocation: number; marketingAllocation: number; contributionProfit: number; contributionMargin: number | null; trend: Array<{ period: string; units: number; revenue: number; refunds: number; netRevenue: number }> };
type ProductData = { hasData: boolean; currency: string; period: { start: string; end: string } | null; products: ProductProfit[] };

function Products({ openCosts, reportRunId }: { openCosts: (sku: string | null) => void; reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<ProductData | null>(null);
  const [comparisonData, setComparisonData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
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
  const exportProducts = () => downloadCsv("product-profitability.csv", [["Report", "Product profitability"], ["Period", data?.period ? `${data.period.start} to ${data.period.end}` : "No imported orders"], ["Currency", data?.currency || "GBP"], ["Shared-cost allocation", "Payment fees and Meta spend are proportional to product net revenue in the selected period"], ["Generated at", new Date().toISOString()], [], ["Product", "Variant", "SKU", "Units", "Sales after discounts", "Discounts", "Refunds", "Net revenue", "COGS", "Gross profit", "Gross margin", "Shipping", "Handling", "Payment fees", "Marketing allocation", "Contribution profit", "Contribution margin"], ...visibleProducts.map((product) => [product.product, product.variant, product.sku || "", product.units, product.revenue, product.discounts, product.refunds, product.netRevenue, product.cogs, product.grossProfit, product.margin === null ? "" : product.margin, product.shippingCosts, product.handlingCosts, product.transactionFeeAllocation, product.marketingAllocation, product.contributionProfit, product.contributionMargin === null ? "" : product.contributionMargin])]);
  return <>
    {loading ? <div className="data-loading">Calculating product profitability…</div> : data && !data.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to see product profitability</strong><span>Revenue, costs, and contribution margin become available after your first order sync.</span></div></div> : null}
    {selectedProduct?.trend.length ? <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">PRODUCT TREND</span><h2>{selectedProduct.product} · {selectedProduct.variant}</h2></div><span className="report-note">Monthly net revenue and units for the current date selection.</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>Units</th><th>Sales after discounts</th><th>Refunds</th><th>Net revenue</th></tr></thead><tbody>{selectedProduct.trend.map((period) => <tr key={period.period}><td><strong>{period.period}</strong></td><td>{period.units.toLocaleString()}</td><td>{formatter.format(period.revenue)}</td><td>{period.refunds ? formatter.format(-period.refunds) : "—"}</td><td><strong>{formatter.format(period.netRevenue)}</strong></td></tr>)}</tbody></table></div></section> : null}
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">PRODUCT PERFORMANCE</span><h2>Product profitability</h2></div><div className="feature-actions"><span className="report-note">Payment fees and marketing spend are allocated by product net revenue. Effective-dated product, shipping, and handling costs use each order date.</span><button className="export-button" disabled={!data?.products.length} onClick={exportProducts}><Download/> Export CSV</button></div></div>
      {data?.hasData ? <>
        <div className="filter-row"><div className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU..."/></div><select aria-label="Product filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All products</option><option value="missing">Missing costs</option><option value="low-margin">Contribution margin under 30%</option><option value="loss-making">Loss-making contribution</option></select><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)}/></label><label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)}/></label>{(fromDate || toDate) && <button onClick={() => { setFromDate(""); setToDate(""); }}>All imported data</button>}</div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Units</th><th>Sales after discounts</th><th>Refunds</th><th>Net revenue</th><th>COGS</th><th>Gross profit</th><th>Gross margin</th><th>Shipping</th><th>Handling</th><th>Payment fees</th><th>Marketing</th><th>Contribution profit</th><th>Contribution margin</th><th>Contribution vs previous</th><th/></tr></thead><tbody>{visibleProducts.length ? visibleProducts.map((product) => { const previous = comparisonByKey.get(product.key); const change = previous ? percentChange(product.contributionProfit, previous.contributionProfit) : null; return <tr key={product.key}><td><strong>{product.product}</strong><small>{product.variant}</small></td><td>{product.sku || "—"}</td><td>{product.units.toLocaleString()}</td><td><strong>{formatter.format(product.revenue)}</strong>{product.discounts > 0 && <small>{formatter.format(product.discounts)} discounts</small>}</td><td>{product.refunds ? formatter.format(-product.refunds) : "—"}</td><td><strong>{formatter.format(product.netRevenue)}</strong></td><td>{product.missingCostUnits ? <span className="cost-warning">{product.missingCostUnits.toLocaleString()} units missing cost</span> : formatter.format(product.cogs)}</td><td>{product.missingCostUnits ? "—" : <strong>{formatter.format(product.grossProfit)}</strong>}</td><td>{product.margin === null ? "—" : `${(product.margin * 100).toFixed(1)}%`}</td><td>{formatter.format(product.shippingCosts)}</td><td>{formatter.format(product.handlingCosts)}</td><td>{formatter.format(product.transactionFeeAllocation)}</td><td>{formatter.format(product.marketingAllocation)}</td><td>{product.missingCostUnits ? "—" : <strong>{formatter.format(product.contributionProfit)}</strong>}</td><td>{product.contributionMargin === null ? "—" : `${(product.contributionMargin * 100).toFixed(1)}%`}</td><td>{comparisonData ? previous ? change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "New" : "Select both dates"}</td><td><div className="feature-actions"><button onClick={() => setSelectedProductKey(product.key)}>Trend</button><button onClick={() => openCosts(product.sku)}>Costs</button></div></td></tr>; }) : <tr><td colSpan={17} className="empty-row">No products match that filter.</td></tr>}</tbody></table></div>
      </> : <div className="cost-empty"><Package/><strong>Product report ready</strong><span>Connect Shopify and run your first order sync to populate this report.</span></div>}
    </section>
  </>;
}

type CustomerRow = { id: string; display_name: string | null; number_of_orders: number; amount_spent: string; currency: string; updated_at_shopify: string };
type CustomerData = {
  hasData: boolean;
  currency: string;
  metrics: { customers: number; repeatCustomers: number; repeatCustomerRate: number | null; newCustomerOrders: number; newCustomerSales: number; repeatCustomerOrders: number; repeatCustomerSales: number; guestOrders: number; guestSales: number; repeatRevenueRate: number | null; repeatOrderRate: number | null; newCustomerAverageOrderValue: number | null; repeatCustomerAverageOrderValue: number | null; averageOrdersPerCustomer: number | null; averageCustomerValue: number | null; averageDaysToSecondOrder: number | null };
  customers: CustomerRow[];
  customerDetailsMasked?: boolean;
  months: Array<{ key: string; newCustomerOrders: number; newCustomerSales: number; repeatCustomerOrders: number; repeatCustomerSales: number }>;
  cohorts: Array<{ key: string; customers: number; periods: Array<{ period: number; activeCustomers: number; retentionRate: number; revenue: number; cumulativeRevenue: number }> }>;
};

function Customers({ reportRunId }: { reportRunId?: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cohortMetric, setCohortMetric] = useState<"retention" | "revenue">("retention");
  useEffect(() => {
    fetch("/api/analytics/customers")
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: CustomerData | null) => { setData(payload); finishReportRun(payload ? "completed" : "failed", payload?.customers.length ?? null); })
      .catch(() => { setData(null); finishReportRun("failed", null, "Customer data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [finishReportRun]);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: data?.currency || "GBP", maximumFractionDigits: 0 });
  const metrics = data ? [
    ["CUSTOMERS", data.metrics.customers.toLocaleString(), `${data.metrics.repeatCustomers.toLocaleString()} repeat customers`],
    ["NEW-CUSTOMER SALES", formatter.format(data.metrics.newCustomerSales), `${data.metrics.newCustomerOrders.toLocaleString()} first orders · ${data.metrics.newCustomerAverageOrderValue === null ? "—" : formatter.format(data.metrics.newCustomerAverageOrderValue)} AOV`],
    ["REPEAT SALES", formatter.format(data.metrics.repeatCustomerSales), data.metrics.repeatRevenueRate === null ? "No repeat sales yet" : `${(data.metrics.repeatRevenueRate * 100).toFixed(1)}% sales · ${data.metrics.repeatOrderRate === null ? "—" : (data.metrics.repeatOrderRate * 100).toFixed(1) + "%"} repeat orders · ${data.metrics.repeatCustomerAverageOrderValue === null ? "—" : formatter.format(data.metrics.repeatCustomerAverageOrderValue)} AOV`],
    ["REPEAT CUSTOMER RATE", data.metrics.repeatCustomerRate === null ? "—" : `${(data.metrics.repeatCustomerRate * 100).toFixed(1)}%`, "Customers with more than one order"],
  ] : [];
  const exportCustomers = () => { if (data) downloadCsv("shopify-customers.csv", [["Report", "Shopify customers"], ["Currency", data.currency], ["Generated at", new Date().toISOString()], [], ["Customer", "Orders", "Lifetime spend", "Last updated"], ...data.customers.map((customer) => [customer.display_name || "Unnamed customer", customer.number_of_orders, Number(customer.amount_spent), customer.updated_at_shopify])]); };
  return <>{loading ? <div className="data-loading">Calculating customer metrics…</div> : !data?.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to analyse your customer base</strong><span>Customer metrics appear after orders have been imported.</span></div></div> : <><section className="metric-grid">{metrics.map(([label, value, hint]) => <article className="metric-card" key={label}><div className="metric-head"><span>{label}</span><Users/></div><strong>{value}</strong><div className="metric-foot"><span>{hint}</span></div></article>)}</section><section className="cost-grid live"><div><strong>{data.metrics.averageCustomerValue === null ? "—" : formatter.format(data.metrics.averageCustomerValue)}</strong><span>Average customer value</span></div><div><strong>{data.metrics.averageOrdersPerCustomer === null ? "—" : data.metrics.averageOrdersPerCustomer.toFixed(2)}</strong><span>Orders per customer</span></div><div><strong>{data.metrics.averageDaysToSecondOrder === null ? "—" : `${data.metrics.averageDaysToSecondOrder.toFixed(0)} days`}</strong><span>Average time to second order</span></div></section>{data.customerDetailsMasked ? <div className="connection-notice"><Info/><div><strong>Customer names are masked for your role</strong><span>Sales and retention metrics remain available. Ask a workspace owner or admin for customer-level access.</span></div></div> : null}{data.metrics.guestOrders > 0 ? <div className="connection-notice"><Info/><div><strong>{data.metrics.guestOrders.toLocaleString()} guest orders are separate from customer cohorts</strong><span>{formatter.format(data.metrics.guestSales)} is excluded from new-versus-repeat classification because Shopify has no customer record for these orders.</span></div></div> : null}<section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CUSTOMER TREND</span><h2>New versus repeat sales</h2></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>New orders</th><th>New-customer sales</th><th>Repeat orders</th><th>Repeat sales</th></tr></thead><tbody>{data.months.length ? data.months.map((month) => <tr key={month.key}><td>{new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(`${month.key}-01T00:00:00Z`))}</td><td>{month.newCustomerOrders.toLocaleString()}</td><td><strong>{formatter.format(month.newCustomerSales)}</strong></td><td>{month.repeatCustomerOrders.toLocaleString()}</td><td><strong>{formatter.format(month.repeatCustomerSales)}</strong></td></tr>) : <tr><td colSpan={5} className="empty-row">No customer trend data yet.</td></tr>}</tbody></table></div></section><section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">RETENTION COHORTS</span><h2>Customers retained after their first order</h2></div><div className="feature-actions"><span className="report-note">Each row starts in the month a customer first placed a valid Shopify order.</span><select aria-label="Cohort metric" value={cohortMetric} onChange={(event) => setCohortMetric(event.target.value as "retention" | "revenue")}><option value="retention">Customer retention</option><option value="revenue">Cumulative revenue</option></select></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>First-order cohort</th><th>Customers</th>{Array.from({ length: 7 }, (_, period) => <th key={period}>Month {period}</th>)}</tr></thead><tbody>{data.cohorts.length ? data.cohorts.map((cohort) => <tr key={cohort.key}><td>{new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(`${cohort.key}-01T00:00:00Z`))}</td><td>{cohort.customers.toLocaleString()}</td>{cohort.periods.map((period) => <td key={period.period}>{cohortMetric === "retention" ? <><strong>{(period.retentionRate * 100).toFixed(1)}%</strong><small>{period.activeCustomers.toLocaleString()} customers</small></> : <><strong>{formatter.format(period.cumulativeRevenue)}</strong><small>through Month {period.period}</small></>}</td>)}</tr>) : <tr><td colSpan={9} className="empty-row">No customer cohorts yet.</td></tr>}</tbody></table></div></section><section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CUSTOMER VALUE</span><h2>Top Shopify customers</h2></div><button className="export-button" disabled={!data.customers.length} onClick={exportCustomers}><Download/> Export CSV</button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Customer</th><th>Orders</th><th>Lifetime spend</th><th>Last updated</th></tr></thead><tbody>{data.customers.map((customer) => <tr key={customer.id}><td>{customer.display_name || "Unnamed customer"}</td><td>{customer.number_of_orders.toLocaleString()}</td><td>{formatter.format(Number(customer.amount_spent))}</td><td>{new Date(customer.updated_at_shopify).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div></section></>}</>;
}

type SavedReport = { id: string; name: string; description: string | null; report_type: "overview" | "pnl" | "sales" | "products" | "customers" | "utm"; visibility: "private" | "organization"; is_favorite: boolean; configuration: { schemaVersion?: number; datePreset?: "all_imported" | "latest_30_days" | "latest_90_days" }; definition_version: number; last_successful_run_at: string | null; updated_at: string };
type SavedReportRun = { id: string; report_id: string; definition_version: number; status: "running" | "completed" | "failed"; row_count: number | null; error_message: string | null; started_at: string; completed_at: string | null };
const reportViews: Record<SavedReport["report_type"], View> = { overview: "Overview", pnl: "Profit & Loss", sales: "Sales", products: "Products", customers: "Customers", utm: "UTM Analysis" };
const reportTypeLabels: Record<SavedReport["report_type"], string> = { overview: "Overview", pnl: "Profit & Loss", sales: "Sales orders", products: "Product profitability", customers: "Customers", utm: "UTM analysis" };
const datePresetLabels = { all_imported: "All imported data", latest_30_days: "Latest 30 days", latest_90_days: "Latest 90 days" } as const;
const starterReports: Array<{ name: string; description: string; reportType: SavedReport["report_type"] }> = [
  { name: "Income statement", description: "Review sales, product costs, operating costs, and profit.", reportType: "pnl" },
  { name: "Product profitability", description: "Find products with missing costs or low margins.", reportType: "products" },
  { name: "Customer retention", description: "Track new and repeat customer sales.", reportType: "customers" },
  { name: "UTM performance", description: "Review Shopify last-touch campaign results.", reportType: "utm" },
];

function Reports({ openReport }: { openReport: (view: View, preset: "all_imported" | "latest_30_days" | "latest_90_days", runId: string) => void }) {
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
    openReport(reportViews[report.report_type], report.configuration?.datePreset ?? "all_imported", payload.run.id);
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
  return <><section className="cost-toolbar"><div><span className="eyebrow">REPORT LIBRARY</span><h2>Saved reports</h2><p>Keep the report views you revisit, then share them with your workspace when ready.</p></div><div className="feature-actions"><button onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Current reports" : "Archived reports"}</button>{!showArchived && <button className="primary" onClick={() => setShowSave(true)}><Plus/> Save report</button>}</div></section><section className="panel report-panel starter-reports"><div className="panel-head"><div><span className="eyebrow">STARTER TEMPLATES</span><h2>Begin with a trusted view</h2></div></div><div className="template-grid">{starterReports.map((template) => <button key={template.name} onClick={() => { setForm({ name: template.name, description: template.description, reportType: template.reportType, visibility: "private", datePreset: "all_imported" }); setShowSave(true); }}><strong>{template.name}</strong><span>{template.description}</span></button>)}</div></section>{error && <div className="connection-error cost-error">{error}</div>}<section className="panel report-panel">{loading ? <div className="data-loading">Loading saved reports…</div> : reports.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Report</th><th>Version</th><th>Type</th><th>Access</th><th>Period</th><th>Last successful run</th><th>Updated</th><th/></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.name}</strong>{report.description && <small>{report.description}</small>}</td><td>v{report.definition_version}</td><td>{reportTypeLabels[report.report_type]}</td><td>{report.visibility === "organization" ? "Workspace shared" : "Private"}</td><td>{datePresetLabels[report.configuration?.datePreset ?? "all_imported"]}</td><td>{report.last_successful_run_at ? new Date(report.last_successful_run_at).toLocaleString("en-GB") : "Not run yet"}</td><td>{new Date(report.updated_at).toLocaleDateString("en-GB")}</td><td><div className="feature-actions"><button className={report.is_favorite ? "favourite-report active" : "favourite-report"} title={report.is_favorite ? "Remove favourite" : "Add favourite"} onClick={() => void toggleFavorite(report)}>{report.is_favorite ? "★" : "☆"}</button><button onClick={() => void runReport(report)}>Open</button><button onClick={() => void showRunHistory(report)}>History</button><button onClick={() => beginRename(report)}>Rename</button><button onClick={() => void duplicate(report)}>Duplicate</button>{showArchived ? <button onClick={() => void restore(report)}>Restore</button> : <button className="icon-button" title="Archive report" onClick={() => void archive(report)}><Trash2/></button>}</div></td></tr>)}</tbody></table></div> : <div className="cost-empty"><Table2/><strong>No saved reports yet</strong><span>Save a report configuration to keep it in your library.</span></div>}</section>{showSave && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowSave(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><Table2/></span><div><span className="eyebrow">REPORT LIBRARY</span><h2>Save report</h2></div></div><label className="form-field"><span>Report name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Weekly P&L"/></label><label className="form-field"><span>Report type</span><select value={form.reportType} onChange={(event) => setForm({ ...form, reportType: event.target.value })}>{Object.entries(reportTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>Access</span><select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}><option value="private">Private to me</option><option value="organization">Share with workspace</option></select></label><label className="form-field"><span>Date range</span><select value={form.datePreset} onChange={(event) => setForm({ ...form, datePreset: event.target.value })}>{Object.entries(datePresetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>Description <small>Optional</small></span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What this view is for"/></label><div className="modal-actions"><button onClick={() => setShowSave(false)}>Cancel</button><button className="primary" disabled={!form.name.trim() || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save report"}</button></div></section></div>}{editing && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setEditing(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><Table2/></span><div><span className="eyebrow">REPORT LIBRARY</span><h2>Edit report</h2></div></div><label className="form-field"><span>Report name</span><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}/></label><label className="form-field"><span>Access</span><select value={editForm.visibility} onChange={(event) => setEditForm({ ...editForm, visibility: event.target.value })}><option value="private">Private to me</option><option value="organization">Share with workspace</option></select></label><label className="form-field"><span>Description <small>Optional</small></span><input value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}/></label><div className="modal-actions"><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={!editForm.name.trim()} onClick={() => void rename()}>Save changes</button></div></section></div>}{runHistoryReport && <div className="modal-backdrop" onMouseDown={() => setRunHistoryReport(null)}><section className="connection-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setRunHistoryReport(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><RefreshCw/></span><div><span className="eyebrow">REPORT HISTORY</span><h2>{runHistoryReport.name}</h2></div></div>{runHistoryLoading ? <div className="data-loading">Loading report runs…</div> : runHistory.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Started</th><th>Version</th><th>Status</th><th>Rows</th><th>Result</th></tr></thead><tbody>{runHistory.map((run) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString("en-GB")}</td><td>v{run.definition_version}</td><td><strong>{run.status}</strong></td><td>{run.row_count?.toLocaleString() ?? "—"}</td><td>{run.status === "failed" ? run.error_message || "Report failed" : run.completed_at ? `Completed ${new Date(run.completed_at).toLocaleTimeString("en-GB")}` : "In progress"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><RefreshCw/><strong>No report runs yet</strong><span>Open this saved report to create its first tracked run.</span></div>}<div className="modal-actions"><button onClick={() => setRunHistoryReport(null)}>Close</button><button className="primary" onClick={() => { const report = runHistoryReport; setRunHistoryReport(null); void runReport(report); }}><RefreshCw/> Run again</button></div></section></div>}</>;
}

function Generic({ view }: { view: View }) { return <section className="panel empty-feature"><div className="feature-icon"><BarChart3/></div><span className="eyebrow">COMING INTO FOCUS</span><h2>{view}</h2><p>The product shell is ready. This report will use the same trusted Shopify financial model, filters and export workflow.</p><button className="primary"><Plus/> Create report</button></section>; }

type Freshness = { connected: boolean; storeName: string | null; lastSuccessfulSync: string | null; recordsProcessed: number; warnings: number; latestStatus: string | null; latestError: string | null };

export function AnalyticsApp() {
  const [view, setView] = useState<View>("Overview");
  const [costSku, setCostSku] = useState<string | null>(null);
  const [pnlPreset, setPnlPreset] = useState<"all_imported" | "latest_30_days" | "latest_90_days">("all_imported");
  const [activeReportRun, setActiveReportRun] = useState<{ id: string; view: View } | null>(null);
  const [account, setAccount] = useState({ name: "Account", email: "" });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const router = useRouter();
  const activeStoreName = freshness?.storeName || "Your store";
  useEffect(() => { fetch("/api/analytics/freshness").then(async (response) => response.ok ? response.json() : null).then((payload: Freshness | null) => setFreshness(payload)).catch(() => setFreshness(null)); }, []);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => { const user = data.user; if (!user) return; const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : typeof user.user_metadata?.name === "string" ? user.user_metadata.name : ""; setAccount({ name: metadataName || user.email?.split("@")[0] || "Account", email: user.email || "" }); }); }, []);
  const logout = async () => { await createClient().auth.signOut(); router.push("/auth/login"); router.refresh(); };
  const openSync = () => { setView("Connections"); setMobileOpen(false); };
  const freshnessHeading = !freshness ? "SHOPIFY DATA" : !freshness.connected ? "SHOPIFY NOT CONNECTED" : freshness.latestStatus === "running" ? "IMPORTING SHOPIFY" : freshness.latestStatus === "failed" || freshness.latestStatus === "interrupted" ? "SYNC NEEDS ATTENTION" : freshness.lastSuccessfulSync ? "SHOPIFY SYNCED" : "READY TO SYNC";
  const freshnessDetail = freshness?.latestStatus === "running" ? "Importing your Shopify catalogue and orders" : freshness?.latestStatus === "interrupted" ? "Open Connections to resume the saved import" : freshness?.lastSuccessfulSync ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(freshness.lastSuccessfulSync)) : freshness?.latestStatus === "failed" ? "Open Connections to review the failed sync" : "Open Connections to import Shopify data";
  return <div className="app-shell">
    <aside className={mobileOpen?"sidebar open":"sidebar"}><div className="brand"><span className="brand-mark"><Image src="/spine-logo.png" alt="" width={34} height={34} priority /></span><span><b>Spine</b><small>The backbone of your business</small></span><button className="mobile-close" onClick={()=>setMobileOpen(false)}><X/></button></div><button className="store-switcher"><span className="store-icon"><ShoppingBag/></span><span><small>STORE</small><b>{activeStoreName}</b></span><ChevronDown/></button><nav>{nav.map((item)=><div key={item.label}>{item.section&&<span className="nav-section">{item.section}</span>}<button className={view===item.label?"nav-item active":"nav-item"} onClick={()=>{setActiveReportRun(null);setView(item.label);setMobileOpen(false)}}><item.icon/><span>{item.label}</span></button></div>)}</nav><div className="sidebar-bottom"><button className="nav-item"><Settings/><span>Settings</span></button><button className="nav-item" onClick={logout}><LogOut/><span>Sign out</span></button><div className="user-card"><div>{account.name.slice(0, 2).toUpperCase()}</div><span><b>{account.name}</b><small>{account.email}</small></span></div></div></aside>
    <main className="main"><header className="topbar"><button className="menu-button" onClick={()=>setMobileOpen(true)}><Menu/></button><div className="breadcrumb"><span>{activeStoreName}</span><b>/</b><strong>{view}</strong></div><div className="top-actions"><button className="date-button" title="Date filtering is coming next"><CalendarDays/><span>All imported data</span><ChevronDown/></button><button className="icon-button" onClick={openSync} title="Open Shopify sync"><RefreshCw/></button><button className="export-button" onClick={()=>setView("Reports")}><Table2/> Reports</button></div></header>
      <div className="content"><div className="page-heading"><div><span className="eyebrow">ECOMMERCE INTELLIGENCE</span><h1>{view}</h1><p>{view==="Overview"?"A clear view of what your store earned—not just what it sold.":view==="UTM Analysis"?"Understand which traffic sources create profitable customers.":view==="Profit & Loss"?"Your ecommerce income statement, based on all imported Shopify data.":`Manage and analyse your ${view.toLowerCase()}.`}</p></div><div className="freshness"><span className={freshness?.latestStatus === "failed" ? "sync-dot syncing" : "sync-dot"}/><div><small>{freshnessHeading}</small><b>{freshnessDetail}</b></div></div></div>
        {view==="Overview"?<Overview reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Profit & Loss"?<ProfitLoss savedPreset={pnlPreset} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Sales"?<Sales reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="UTM Analysis"?<UTMAnalysis reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Products"?<Products reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} openCosts={(sku) => { setCostSku(sku); setView("Costs"); }}/>:view==="Customers"?<Customers reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Costs"?<Costs focusSku={costSku}/>:view==="Expenses"?<Expenses/>:view==="Reports"?<Reports openReport={(target, preset, runId) => { setPnlPreset(preset); setActiveReportRun({ id: runId, view: target }); setView(target); }}/>:view==="Connections"?<Connections/>:<Generic view={view}/>}</div>
    </main>
  </div>;
}
