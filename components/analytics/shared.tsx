"use client";

import { useCallback, useRef } from "react";
import { type ReportingGranularity, type ReportingPeriod } from "@/lib/analytics/reporting-periods";
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, Database, FileBarChart, Info, LayoutDashboard, Megaphone, Package, PhoneCall, Settings, ShoppingBag, Table2, TrendingUp, Users, WalletCards } from "lucide-react";
import { fetchJson } from "@/lib/queries/client";

export type View = "Revenue & Costs" | "Overview" | "Profit & Loss" | "Sales" | "UTM Analysis" | "Products" | "Leads" | "Pipeline outcomes" | "Stage ageing" | "Lead sources" | "Sales team" | "Forecast" | "Lost reasons" | "Follow-ups" | "Customers" | "Customer cohorts" | "Repurchase rates" | "Time between orders" | "Product journeys" | "New versus repeat sales" | "Top Shopify customers" | "Sales by country" | "Costs" | "Expenses" | "Reports" | "Connections" | "Settings" | "Team";

export type DrilldownContext = { from?: string; to?: string; search?: string; source?: string; medium?: string; campaign?: string; landingPage?: string; customerType?: string; country?: string; product?: string; comparisonMode?: "previous_period" | "previous_year"; attributionModel?: "first_touch" | "last_touch" };

export const default365DayRange = (() => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
})();

export type FinanceDatePreset = "today" | "yesterday" | "last_7_days" | "last_7_complete_days" | "last_30_days" | "last_30_complete_days" | "last_90_days" | "last_365_days" | "this_month" | "last_month" | "all_imported" | "custom";

export function financeDateRange(preset: FinanceDatePreset) {
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

export function FinanceDateControls({ preset, from, to, onPreset, onFrom, onTo, groupBy, onGroupBy }: {
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

export type NavigationItem = { label: View; display?: string; icon: typeof LayoutDashboard; section?: string; subItem?: boolean };

export const ecommerceNav: NavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Profit & Loss", icon: FileBarChart, section: "REPORTING" },
  { label: "Sales", icon: ShoppingBag },
  { label: "UTM Analysis", icon: Megaphone },
  { label: "Products", icon: Package },
  { label: "Customers", icon: Users },
  { label: "Customer cohorts", display: "Cohorts", icon: Users, subItem: true },
  { label: "Repurchase rates", display: "Repurchase", icon: Users, subItem: true },
  { label: "Time between orders", display: "Order gaps", icon: Users, subItem: true },
  { label: "Product journeys", display: "Journeys", icon: Users, subItem: true },
  { label: "New versus repeat sales", display: "New vs repeat", icon: BarChart3, subItem: true },
  { label: "Top Shopify customers", display: "Top customers", icon: Users, subItem: true },
  { label: "Sales by country", display: "Countries", icon: BarChart3, subItem: true },
  { label: "Costs", icon: WalletCards, section: "DATA" },
  { label: "Expenses", icon: WalletCards },
  { label: "Reports", icon: Table2 },
  { label: "Connections", icon: Database },
  { label: "Settings", icon: Settings, section: "MANAGE" },
  { label: "Team", icon: Users },
];

export const leadGenerationNav: NavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Leads", icon: PhoneCall, section: "LEAD GENERATION" },
  { label: "Revenue & Costs", icon: Database },
  { label: "Pipeline outcomes", icon: BarChart3, section: "DEEP DIVES" },
  { label: "Stage ageing", icon: CalendarDays },
  { label: "Lead sources", icon: Megaphone },
  { label: "Sales team", icon: Users },
  { label: "Forecast", icon: TrendingUp },
  { label: "Lost reasons", icon: ArrowDownRight },
  { label: "Follow-ups", icon: PhoneCall },
  { label: "Connections", icon: Database, section: "INTEGRATIONS" },
  { label: "Settings", icon: Settings, section: "MANAGE" },
  { label: "Team", icon: Users },
];

export function Trend({ positive = true, neutral = false, children }: { positive?: boolean; neutral?: boolean; children: React.ReactNode }) {
  if (neutral) return <span className="trend" style={{ color: "#6655bf", background: "#f1efff" }}><Info />{children}</span>;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <span className={positive ? "trend up" : "trend down"}><Icon />{children}</span>;
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useReportRun(reportRunId?: string) {
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

export type CurrencyCoverage = { reportingCurrency: string; includedOrders: number; convertedOrders: number; excludedOrders: number; convertedCurrencies: Array<{ currency: string; orders: number }>; excludedCurrencies: Array<{ currency: string; orders: number }> };

export type CurrencyConversionCoverage = { reportingCurrency: string; includedRows: number; convertedRows: number; excludedRows: number; convertedCurrencies: Array<{ currency: string; rows: number }>; excludedCurrencies: Array<{ currency: string; rows: number }> };

export type PnlData = {
  hasData: boolean;
  microsoftAdsImportError?: string | null;
  currency: string;
  timezone: string;
  currencyCoverage: CurrencyCoverage;
  marketingCurrencyCoverage: CurrencyConversionCoverage;
  transactionFeeCoverage?: { salesDays: number; reportedFeeDays: number; latestReportedFeeDate: string | null };
  metrics: { grossSales: number; discounts: number; refunds: number; netProductSales: number; shippingRevenue: number; tax: number; duties: number; totalSales: number; cogs: number; grossProfit: number; grossMargin: number | null; marketingSpend: number; metaMarketingSpend: number; googleMarketingSpend: number; bingMarketingSpend: number; transactionFees: number; shopifyPaymentFees: number; estimatedProcessorFees: number; estimatedShopifySurcharge: number; merchantShippingCosts: number; variantShippingCosts: number; shippingFallbackCosts: number; handlingCosts: number; fixedOperatingExpenses: number; variableOperatingExpenses: number; operatingExpenses: number; contributionMarginBeforeShipping: number; contributionMarginBeforeShippingPercentage: number | null; contributionMargin: number; contributionMarginPercentage: number | null; profitAfterOperatingCosts: number; profitAfterKnownCosts: number; profitAfterMarketingSpend: number; netProfit: number | null; netMargin: number | null; orders: number; unitsSold: number; missingCostLines: number; missingShippingLines: number; shippingOverrideLines: number; shippingFallbackLines: number; shippingFallbackRate: number | null; unallocatedOperatingCosts: number };
  externalPaymentFees?: { available: boolean; plan: string | null; surchargeRate: number | null; transactions: number; byGateway: Array<{ gateway: string; payments: number; transactions: number; processorFees: number; shopifySurcharge: number }> };
  availability: { marketingSpend: boolean; metaMarketingSpend: boolean; googleMarketingSpend: boolean; bingMarketingSpend: boolean; transactionFees: boolean; transactionFeesComplete?: boolean; shippingCosts: boolean; handlingCosts: boolean; operatingExpenses: boolean; netProfit: boolean };
  period: { start: string; end: string } | null;
};

export type PnlPeriodData = { period: ReportingPeriod; data: PnlData };

export const pnlSeriesKey = (period: { start: string; end: string }) => `${period.start}_${period.end}`;

/**
 * Many P&L periods via /api/analytics/pnl/series, keyed by pnlSeriesKey().
 * Adjacent periods share one server-side load; 120 per request keeps a
 * year of daily periods to a few requests.
 */
export async function fetchPnlSeries(periods: Array<{ start: string; end: string }>, signal?: AbortSignal) {
  const results = new Map<string, PnlData>();
  for (let index = 0; index < periods.length; index += 120) {
    const batch = periods.slice(index, index + 120).map(pnlSeriesKey).join(",");
    const payload = await fetchJson<{ periods: Array<{ start: string; end: string; data: PnlData }> }>(`/api/analytics/pnl/series?periods=${batch}`, { signal });
    for (const period of payload.periods) results.set(pnlSeriesKey(period), period.data);
  }
  return results;
}

export type UtmRow = { channel: string; source: string; medium: string; campaign: string; content: string; term: string; landingPage: string; customerType: string; sales: number; refunds: number; cogs: number; missingCostUnits: number; marketingCost: number | null; orders: number; customers: number; newCustomerSales: number; averageOrderValue: number; revenuePerCustomer: number | null };

export type UtmData = { hasData: boolean; currency: string; timezone: string; attributionModel: "first_touch" | "last_touch"; filterOptions: { countries: string[]; products: string[] }; mappingCoverage: { importedCampaigns: number; mappedCampaigns: number; customSpendRows: number; customSpend: number; mappedSpend: number; allocatedSpend: number; unmappedSpend: number; unallocatedSpend: number; currencyCoverage: CurrencyConversionCoverage }; period: { start: string; end: string } | null; totals: { sales: number; refunds: number; cogs: number; missingCostUnits: number; orders: number; attributedOrders: number; customers: number; newCustomerSales: number; averageOrderValue: number; revenuePerCustomer: number | null }; diagnostics: { missingAttribution: { orders: number; sales: number }; missingUtm: { orders: number; sales: number }; missingLandingPage: { orders: number; sales: number }; missingReferrer: { orders: number; sales: number } }; trends: Array<{ period: string; sales: number; orders: number; customers: number; newCustomerSales: number }>; rows: UtmRow[] };

export type ProductProfit = { key: string; product: string; variant: string; sku: string | null; units: number; revenue: number; discounts: number; refunds: number; netRevenue: number; cogs: number; grossProfit: number; margin: number | null; missingCostUnits: number; shippingCosts: number; handlingCosts: number; transactionFeeAllocation: number; marketingAllocation: number; contributionProfit: number; contributionMargin: number | null; trend: Array<{ period: string; units: number; revenue: number; refunds: number; netRevenue: number }> };

export type ProductData = { hasData: boolean; currency: string; timezone: string; marketingCurrencyCoverage: CurrencyConversionCoverage; period: { start: string; end: string } | null; products: ProductProfit[] };

export type CustomerRow = { id: string; display_name: string | null; number_of_orders: number; amount_spent: number; currency: string; last_order_at: string | null; country_code?: string | null };

export type CustomerData = {
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
