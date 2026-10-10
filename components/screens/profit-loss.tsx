"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton, TableRowSkeleton } from "@/components/ui/skeleton";
import { pagedReportingPeriods, type ReportingGranularity } from "@/lib/analytics/reporting-periods";
import { fetchCachedJson } from "@/lib/analytics/client-response-cache";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import { buildPnlExport, formatPnlValue, type PnlExportGroup } from "@/lib/exports/pnl";
import type { ColumnStyle } from "@/lib/exports/xlsx";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { ChevronDown, Download, Info } from "lucide-react";
import { type DrilldownContext, default365DayRange, type FinanceDatePreset, financeDateRange, downloadCsv, useReportRun, type PnlData, type PnlPeriodData, pnlSeriesKey, fetchPnlSeries } from "@/components/analytics/shared";
import { PanelState } from "@/components/ui/panel-state";

type PnlRow = { section: string; label: string; value: (data: PnlData) => number | string };

const pnlRowDescriptions: Record<string, string> = {
  "Gross sales": "Sales value before discounts, returns, shipping, tax, and duties.",
  "Discounts": "Discounts applied to orders during the selected period.",
  "Returns and refunds": "Refund value recorded for orders in the selected period. Shown as a deduction.",
  "Net product sales": "Gross product sales less discounts and refunds. Shipping, tax, and duties are excluded.",
  "Shipping revenue": "Shipping amounts paid by customers. Tax and duties are excluded.",
  "Total sales": "Net product sales plus customer shipping revenue. Tax and duties are excluded.",
  "Tax collected (excluded)": "Tax collected from customers, shown for reconciliation and excluded from sales and profit.",
  "Duties collected (excluded)": "Duties collected from customers, shown for reconciliation and excluded from sales and profit.",
  "Product COGS": "Cost of goods sold from effective-dated variant costs, Shopify unit costs, or the configured fallback rate.",
  "Gross profit": "Net product sales less product COGS. This does not yet deduct marketing, fees, shipping, handling, or operating expenses.",
  "Facebook Ads spend": "Imported Meta Ads spend for the selected period, converted to the store currency where a dated rate is available.",
  "Google Ads spend": "Imported Google Ads spend for the selected period, converted to the store currency where a dated rate is available.",
  "Microsoft Ads spend": "Imported Microsoft Advertising spend for the selected period, converted to the store currency where a dated rate is available.",
  "Total marketing spend": "Sum of imported Meta, Google, and Microsoft advertising spend for the selected period.",
  "Shopify payment fees": "Fees imported from Shopify's payment report, including Shopify Payments processing and currency charges where reported. Existing configured fallback rules can cover missing transaction fees.",
  "Estimated external processor fees": "Estimated from successful external-gateway payment value and transaction count. Uses each processor's saved rate, or the editable store default. The fixed amount applies once per successful payment.",
  "Estimated Shopify third-party fees": "Estimated Shopify surcharge on external-gateway payments using the detected or selected store plan. This is separate from the external processor's charge.",
  "Total payment fees": "Imported Shopify payment fees plus estimated external processor charges and any estimated Shopify third-party surcharge. This subtotal is deducted once from profit.",
  "Merchant shipping and fulfilment costs": "Total merchant shipping and fulfilment costs, including fallback and variant-specific costs.",
  "Handling and pick/pack costs": "Handling costs allocated from the configured per-order, per-unit, or other applicable rule.",
  "Store fulfilment fallback": "Shipping and fulfilment costs allocated using the store-level fallback rule for order lines without a variant override.",
  "Variant shipping overrides": "Shipping and fulfilment costs allocated from product or variant-specific rules.",
  "Merchant shipping and fulfilment": "Total merchant shipping and fulfilment costs, including fallback and variant-specific costs.",
  "Handling and pick/pack": "Handling costs allocated from the configured per-order, per-unit, or other applicable rule.",
  "Fixed operating costs": "Fixed operating expenses allocated to the selected dates using their effective dates and cadence.",
  "Variable operating costs": "Variable operating expenses allocated using their configured basis, such as orders, units, or revenue.",
  "Operating expenses": "Fixed plus variable operating expenses.",
  "Profit after known costs": "Gross profit less operating expenses, imported Shopify fees, estimated external processor and Shopify surcharges, merchant shipping, and handling. Marketing spend is not deducted at this step.",
  "Profit after marketing spend": "Profit after known costs less imported Meta, Google, and Microsoft Ads spend.",
  "Contribution margin before shipping": "Gross profit less variable operating costs, payment fees, and marketing spend. Fixed operating costs, shipping, and handling are excluded.",
  "Contribution margin": "Contribution margin before shipping less merchant shipping and handling costs. Fixed operating costs are excluded.",
  "Net profit": "Contribution margin less fixed operating costs. Shown only when required cost coverage is complete.",
  "Gross margin": "Gross profit divided by net product sales after refunds.",
  "Net margin": "Net profit divided by net product sales after refunds. Only available with complete cost coverage.",
  "Refunds / gross sales": "Refunds divided by gross sales for the same period.",
  "COGS / net product sales": "Product cost of goods sold divided by net product sales after refunds.",
  "Marketing / net product sales": "Imported Meta, Google, and Microsoft spend divided by net product sales after refunds.",
  "Blended CAC": "Total imported marketing spend divided by identified new customers.",
  "Blended ROAS": "Tax-exclusive total sales divided by imported marketing spend.",
  "New customer ROAS": "Sales attributed to first valid orders from identified customers divided by imported marketing spend.",
  "New customers": "Identified customers whose first valid imported order falls in this period. Guest orders are excluded.",
  "New customer sales": "Sales from identified customers' first valid imported orders in this period.",
  "Profit per new customer": "Net profit divided by identified new customers. Only available with complete cost coverage.",
  "Repeat customers": "Identified customers with a later valid order in this period. Guest orders are excluded.",
  "Repeat customer sales": "Sales from later orders by identified customers in this period.",
  "Repeat orders": "Later identified-customer orders divided by all identified-customer orders in this period.",
  "Repeat sales": "Sales from later identified-customer orders divided by sales from all identified-customer orders in this period.",
  "Orders": "Number of imported Shopify orders in the selected period.",
  "Average order value": "Tax-exclusive total sales divided by imported orders.",
  "New customer AOV": "Sales from first valid orders divided by the number of those orders.",
  "Repeat customer AOV": "Sales from later identified-customer orders divided by the number of those orders.",
  "Average items per order": "Imported units sold divided by imported orders.",
};

function PnlRowTitle({ label }: { label: string }) {
  const baseLabel = label.replace(/\s*\([^)]*\)$/, "");
  const description = pnlRowDescriptions[label] ?? pnlRowDescriptions[baseLabel] ??
    (label.endsWith(" processor estimate") ? "Estimated processing charge for this gateway. The percentage applies to successful payment value; the fixed amount applies once per successful payment." : "This row shows the selected metric for the reporting period. See Metric definitions for calculation and coverage details.");
  return <span className="pnl-row-title" tabIndex={0} title={description} aria-label={`${label}. ${description}`} data-tooltip={description}>{label}<span className="pnl-row-help" aria-hidden="true">?</span></span>;
}

type PnlCustomerPeriod = {
  start: string; end: string; label: string;
  newCustomers: number; newOrders: number; newSales: number;
  repeatCustomers: number; repeatOrders: number; repeatSales: number;
  guestOrders: number; guestSales: number; excludedCurrencyOrders: number;
};

export function ProfitLoss({ savedPreset, reportRunId, initialRange, storageKey }: { savedPreset?: "all_imported" | "latest_30_days" | "latest_90_days" | "latest_365_days"; reportRunId?: string; initialRange?: DrilldownContext; storageKey: string }) {
  const finishReportRun = useReportRun(reportRunId);
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [comparison, setComparison] = useState<PnlData | null>(null);
  const [yearComparison, setYearComparison] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [fromDate, setFromDate] = useState(initialRange?.from ?? (savedPreset ? "" : default365DayRange.from));
  const [toDate, setToDate] = useState(initialRange?.to ?? (savedPreset ? "" : default365DayRange.to));
  const [datePreset, setDatePreset] = useState<FinanceDatePreset>(initialRange ? "custom" : savedPreset === "all_imported" ? "all_imported" : savedPreset ? "custom" : "last_365_days");
  const [granularity, setGranularity] = useState<ReportingGranularity>("monthly");
  const [periodData, setPeriodData] = useState<PnlPeriodData[]>([]);
  const [periodPage, setPeriodPage] = useState(0);
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
  const [datePrefsReady, setDatePrefsReady] = useState(false);
  const restoredDatePrefs = useRef(false);
  useResetOnChange(`${storageKey}|${initialRange?.from}|${initialRange?.to}`, () => setDatePrefsReady(Boolean(initialRange)));
  useEffect(() => {
    if (initialRange) return;
    restoredDatePrefs.current = false;
    // Restored after the first paint: localStorage is client-only.
    const timeout = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(`spine:pnl-period:${storageKey}`);
        if (saved) {
          const value = JSON.parse(saved) as { preset?: FinanceDatePreset; from?: string; to?: string };
          if (value.preset && ["today", "yesterday", "last_7_days", "last_7_complete_days", "last_30_days", "last_30_complete_days", "last_90_days", "last_365_days", "this_month", "last_month", "all_imported", "custom"].includes(value.preset)) {
            setDatePreset(value.preset);
            setFromDate(value.from ?? "");
            setToDate(value.to ?? "");
            restoredDatePrefs.current = true;
          }
        }
      } catch { /* Ignore malformed saved filters. */ }
      setDatePrefsReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [storageKey, initialRange?.from, initialRange?.to]);
  useEffect(() => {
    if (!datePrefsReady || initialRange) return;
    localStorage.setItem(`spine:pnl-period:${storageKey}`, JSON.stringify({ preset: datePreset, from: fromDate, to: toDate }));
  }, [storageKey, datePrefsReady, initialRange, datePreset, fromDate, toDate]);
  useResetOnChange(datePrefsReady ? `${fromDate}|${toDate}|${feeRefreshVersion}|${retryToken}` : null, () => setLoadError(false));
  useEffect(() => {
    if (!datePrefsReady) return;
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const url = `/api/analytics/pnl${params.size ? `?${params}` : ""}`;
    fetchCachedJson<PnlData>(url, { force: true })
      .then(async (payload: PnlData) => {
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
        const previousPeriod = { start: date(previousStart), end: date(previousEnd) };
        const previousYear = { start: date(previousYearStart), end: date(previousYearEnd) };
        // A failed comparison leaves the main P&L on screen without deltas.
        const series = await fetchPnlSeries([previousPeriod, previousYear]).catch(() => null);
        setComparison(series?.get(pnlSeriesKey(previousPeriod)) ?? null);
        setYearComparison(series?.get(pnlSeriesKey(previousYear)) ?? null);
      })
      .catch(() => { setPnl(null); setComparison(null); setYearComparison(null); setLoadError(true); finishReportRun("failed", null, "Profit and loss data could not be loaded"); })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, feeRefreshVersion, finishReportRun, datePrefsReady, retryToken]);

  useEffect(() => {
    if (initialRange || restoredDatePrefs.current || !savedPreset || !pnl?.period?.end || appliedSavedPreset.current === savedPreset) return;
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
  }, [savedPreset, pnl?.period?.end, initialRange, datePrefsReady]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!pnl?.period || !pnl.hasData) { setPeriodData([]); return; }
      const { periods } = pagedReportingPeriods(pnl.period.start, pnl.period.end, granularity, periodPage);
      setPeriodLoading(true);
      fetchPnlSeries(periods, controller.signal)
        .then((series) => {
          if (controller.signal.aborted) return;
          setPeriodData(periods.flatMap((period): PnlPeriodData[] => {
            const data = series.get(pnlSeriesKey(period));
            return data ? [{ period, data }] : [];
          }));
        }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") setPeriodData([]); }).finally(() => { if (!controller.signal.aborted) setPeriodLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [granularity, periodPage, pnl]);

  useResetOnChange(`${pnl?.period?.start}|${pnl?.period?.end}|${pnl?.hasData}|${granularity}`, () => {
    setCustomerPeriodError(false);
    if (!pnl?.period || !pnl.hasData) setCustomerPeriods([]);
  });
  useEffect(() => {
    if (!pnl?.period || !pnl.hasData) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ from: pnl.period.start, to: pnl.period.end, granularity });
    const loadCustomerPeriods = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`/api/analytics/pnl-customer-kpis?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Customer KPI query failed");
          const payload = await response.json() as { periods: PnlCustomerPeriod[] };
          if (!controller.signal.aborted) setCustomerPeriods(payload.periods);
          return;
        } catch {
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
    ["Shopify payment fees", pnl.metrics.shopifyPaymentFees > 0 ? signed(-pnl.metrics.shopifyPaymentFees) : "Not available"],
    ["Estimated external processor fees", pnl.externalPaymentFees?.available ? signed(-pnl.metrics.estimatedProcessorFees) : "Not imported"],
    ["Estimated Shopify third-party fees", !pnl.externalPaymentFees?.available ? "Not imported" : pnl.externalPaymentFees.surchargeRate !== null ? signed(-pnl.metrics.estimatedShopifySurcharge) : "Select Shopify plan"],
    ["Fixed operating costs", signed(-pnl.metrics.fixedOperatingExpenses)],
    ["Variable operating costs", signed(-pnl.metrics.variableOperatingExpenses)],
    ["Operating expenses", signed(-pnl.metrics.operatingExpenses)],
    ["Profit after known costs", signed(pnl.metrics.profitAfterKnownCosts)],
    ["Facebook Ads spend", pnl.availability.metaMarketingSpend ? signed(-pnl.metrics.metaMarketingSpend) : "Not imported"],
    ["Google Ads spend", pnl.availability.googleMarketingSpend ? signed(-pnl.metrics.googleMarketingSpend) : "Not imported"],
    ["Microsoft Ads spend", pnl.availability.bingMarketingSpend ? signed(-pnl.metrics.bingMarketingSpend) : "Not imported"],
    ["Total marketing spend", pnl.availability.marketingSpend ? signed(-pnl.metrics.marketingSpend) : "Not imported"],
    ["Contribution margin before shipping", pnl.availability.marketingSpend ? signed(pnl.metrics.contributionMarginBeforeShipping) : "Import ad spend to calculate"],
    ["Profit after marketing spend", pnl.availability.marketingSpend ? signed(pnl.metrics.profitAfterMarketingSpend) : "Import ad spend to calculate"],
    [`Store fulfilment fallback (${pnl.metrics.shippingFallbackLines.toLocaleString()} lines · ${pnl.metrics.shippingFallbackRate === null ? "—" : `${(pnl.metrics.shippingFallbackRate * 100).toFixed(1)}%`})`, signed(-pnl.metrics.shippingFallbackCosts)],
    [`Variant shipping overrides (${pnl.metrics.shippingOverrideLines.toLocaleString()} lines)`, signed(-pnl.metrics.variantShippingCosts)],
    ["Merchant shipping and fulfilment costs", pnl.availability.shippingCosts ? signed(-pnl.metrics.merchantShippingCosts) : `${pnl.metrics.missingShippingLines.toLocaleString()} lines need a shipping cost`],
    ["Handling and pick/pack costs", pnl.availability.handlingCosts ? signed(-pnl.metrics.handlingCosts) : "Add a handling or pick/pack rule"],
    ["Contribution margin", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? signed(pnl.metrics.contributionMargin) : "Add marketing, shipping, and handling costs"],
    ["Net profit", pnl.availability.netProfit && pnl.metrics.netProfit !== null ? signed(pnl.metrics.netProfit) : "Complete cost coverage to calculate"],
  ] : [];
  const sections = ["Sales", "Product costs", "Marketing", "Transaction costs", "Shipping and handling", "Custom expenses", "Contribution and net profit"];
  const pnlRows: PnlRow[] = [
    { section: "Sales", label: "Gross sales", value: (data) => (data.metrics.grossSales) },
    { section: "Sales", label: "Discounts", value: (data) => (-data.metrics.discounts) },
    { section: "Sales", label: "Returns and refunds", value: (data) => (-data.metrics.refunds) },
    { section: "Sales", label: "Net product sales", value: (data) => (data.metrics.netProductSales - data.metrics.refunds) },
    { section: "Sales", label: "Shipping revenue", value: (data) => (data.metrics.shippingRevenue) },
    { section: "Sales", label: "Total sales", value: (data) => (data.metrics.totalSales) },
    { section: "Sales", label: "Tax collected (excluded)", value: (data) => (data.metrics.tax) },
    { section: "Sales", label: "Duties collected (excluded)", value: (data) => (data.metrics.duties) },
    { section: "Product costs", label: "Product COGS", value: (data) => (-data.metrics.cogs) },
    { section: "Product costs", label: "Gross profit", value: (data) => (data.metrics.grossProfit) },
    { section: "Marketing", label: "Facebook Ads spend", value: (data) => data.availability.metaMarketingSpend ? (-data.metrics.metaMarketingSpend) : "Not imported" },
    { section: "Marketing", label: "Google Ads spend", value: (data) => data.availability.googleMarketingSpend ? (-data.metrics.googleMarketingSpend) : "Not imported" },
    { section: "Marketing", label: "Microsoft Ads spend", value: (data) => data.availability.bingMarketingSpend ? (-data.metrics.bingMarketingSpend) : "Not imported" },
    { section: "Marketing", label: "Total marketing spend", value: (data) => data.availability.marketingSpend ? (-data.metrics.marketingSpend) : "Not imported" },
    { section: "Transaction costs", label: "Shopify payment fees", value: (data) => data.metrics.shopifyPaymentFees > 0 ? (-data.metrics.shopifyPaymentFees) : "Not available" },
    { section: "Transaction costs", label: "Estimated external processor fees", value: (data) => data.externalPaymentFees?.available ? (-data.metrics.estimatedProcessorFees) : "Not imported" },
    { section: "Transaction costs", label: "Estimated Shopify third-party fees", value: (data) => !data.externalPaymentFees?.available ? "Not imported" : data.externalPaymentFees.surchargeRate !== null ? (-data.metrics.estimatedShopifySurcharge) : "Select Shopify plan" },
    { section: "Transaction costs", label: "Total payment fees", value: (data) => (-data.metrics.transactionFees) },
    { section: "Shipping and handling", label: "Store fulfilment fallback", value: (data) => (-data.metrics.shippingFallbackCosts) },
    { section: "Shipping and handling", label: "Variant shipping overrides", value: (data) => (-data.metrics.variantShippingCosts) },
    { section: "Shipping and handling", label: "Merchant shipping and fulfilment", value: (data) => data.availability.shippingCosts ? (-data.metrics.merchantShippingCosts) : "Coverage needed" },
    { section: "Shipping and handling", label: "Handling and pick/pack", value: (data) => data.availability.handlingCosts ? (-data.metrics.handlingCosts) : "Coverage needed" },
    { section: "Custom expenses", label: "Fixed operating costs", value: (data) => (-data.metrics.fixedOperatingExpenses) },
    { section: "Custom expenses", label: "Variable operating costs", value: (data) => (-data.metrics.variableOperatingExpenses) },
    { section: "Custom expenses", label: "Operating expenses", value: (data) => (-data.metrics.operatingExpenses) },
    { section: "Contribution and net profit", label: "Profit after known costs", value: (data) => (data.metrics.profitAfterKnownCosts) },
    { section: "Contribution and net profit", label: "Contribution margin before shipping", value: (data) => data.availability.marketingSpend ? (data.metrics.contributionMarginBeforeShipping) : "Marketing needed" },
    { section: "Contribution and net profit", label: "Contribution margin", value: (data) => data.availability.marketingSpend && data.availability.shippingCosts && data.availability.handlingCosts ? (data.metrics.contributionMargin) : "Coverage needed" },
    { section: "Contribution and net profit", label: "Net profit", value: (data) => data.availability.netProfit && data.metrics.netProfit !== null ? (data.metrics.netProfit) : "Coverage needed" },
  ];
  const processorNames = [...new Set([pnl, comparison, ...periodData.map((entry) => entry.data)]
    .flatMap((data) => data?.externalPaymentFees?.byGateway.map((gateway) => gateway.gateway) ?? []))].sort();
  const processorRowIndex = pnlRows.findIndex((row) => row.label === "Estimated external processor fees");
  pnlRows.splice(processorRowIndex, 0, ...processorNames.map((gateway): PnlRow => ({
    section: "Transaction costs", label: `${gateway} processor estimate`,
    value: (data) => -(data.externalPaymentFees?.byGateway.find((item) => item.gateway === gateway)?.processorFees ?? 0),
  })));
  const periodWindow = pnl?.period
    ? pagedReportingPeriods(pnl.period.start, pnl.period.end, granularity, periodPage)
    : { periods: [], page: 0, pageCount: 0, totalPeriods: 0 };
  const pagePeriodsLoaded = periodData.length === periodWindow.periods.length && periodData.every((entry, index) =>
    entry.period.start === periodWindow.periods[index].start && entry.period.end === periodWindow.periods[index].end);
  const displayPeriods: PnlPeriodData[] = pagePeriodsLoaded ? periodData : [];
  const displayedColumns = showComparison && comparison?.hasData ? [...displayPeriods, { period: { start: comparison.period?.start ?? "", end: comparison.period?.end ?? "", label: "Previous period" }, data: comparison }] : displayPeriods;
  const chartMaximum = Math.max(...displayPeriods.flatMap(({ data }) => [Math.abs(data.metrics.netProductSales - data.metrics.refunds), Math.abs(data.metrics.grossProfit), Math.abs(data.metrics.netProfit ?? 0)]), 1);
  const summary = pnl ? [
    ["NET PRODUCT SALES", formatter.format(pnl.metrics.netProductSales - pnl.metrics.refunds), `${pnl.metrics.orders.toLocaleString()} orders`],
    ["GROSS PROFIT", formatter.format(pnl.metrics.grossProfit), pnl.metrics.grossMargin === null ? "Cost coverage needed" : `${(pnl.metrics.grossMargin * 100).toFixed(1)}% margin`],
    ["OPERATING EXPENSES", formatter.format(pnl.metrics.operatingExpenses), pnl.metrics.unallocatedOperatingCosts ? `${pnl.metrics.unallocatedOperatingCosts} costs need attention` : `${formatter.format(pnl.metrics.fixedOperatingExpenses)} fixed · ${formatter.format(pnl.metrics.variableOperatingExpenses)} variable`],
    ["MISSING COST LINES", pnl.metrics.missingCostLines.toLocaleString(), pnl.metrics.missingCostLines ? "Add costs to improve profit" : "All order lines costed"],
    ["PROFIT AFTER MARKETING", pnl.availability.marketingSpend ? formatter.format(pnl.metrics.profitAfterMarketingSpend) : "—", pnl.availability.marketingSpend ? "Meta, Google Ads + Microsoft Ads spend included" : "Import ad spend"],
    ["CONTRIBUTION MARGIN", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? formatter.format(pnl.metrics.contributionMargin) : pnl.availability.marketingSpend ? formatter.format(pnl.metrics.contributionMarginBeforeShipping) : "—", pnl.availability.marketingSpend && pnl.availability.shippingCosts && pnl.availability.handlingCosts ? `${pnl.metrics.contributionMarginPercentage === null ? "—" : `${(pnl.metrics.contributionMarginPercentage * 100).toFixed(1)}%`} after shipping and handling` : pnl.availability.marketingSpend ? `${pnl.metrics.contributionMarginBeforeShippingPercentage === null ? "—" : `${(pnl.metrics.contributionMarginBeforeShippingPercentage * 100).toFixed(1)}%`} before shipping and handling` : "Import ad spend"],
  ] : [];
  const totalRows = new Set([3, 5, 9, 15, 16, 20, 21, 22, 25, 27, 28]);
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

  const customerPeriodByRange = new Map(customerPeriods.map((period) => [`${period.start}:${period.end}`, period]));
  const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
  const customerValue = (customer: PnlCustomerPeriod | null, key: keyof PnlCustomerPeriod) => customer ? Number(customer[key]) : "—";
  const pnlKpiGroups: Array<{ heading: string; rows: Array<{ label: string; format: ColumnStyle; value: (data: PnlData, customer: PnlCustomerPeriod | null) => number | string | null }> }> = [
    { heading: "KPIs", rows: [
      { label: "Gross margin", format: "percentage", value: (data) => data.metrics.grossMargin },
      { label: "Net margin", format: "percentage", value: (data) => data.metrics.netMargin },
      { label: "Refunds / gross sales", format: "percentage", value: (data) => ratio(data.metrics.refunds, data.metrics.grossSales) },
      { label: "COGS / net product sales", format: "percentage", value: (data) => ratio(data.metrics.cogs, data.metrics.netProductSales - data.metrics.refunds) },
      { label: "Marketing / net product sales", format: "percentage", value: (data) => data.availability.marketingSpend ? ratio(data.metrics.marketingSpend, data.metrics.netProductSales - data.metrics.refunds) : "—" },
    ] },
    { heading: "Acquisition and retention", rows: [
      { label: "Blended CAC", format: "currency", value: (data, customer) => data.availability.marketingSpend && customer ? ratio(data.metrics.marketingSpend, customer.newCustomers) : "—" },
      { label: "Blended ROAS", format: "multiple", value: (data) => data.availability.marketingSpend ? ratio(data.metrics.totalSales, data.metrics.marketingSpend) : "—" },
      { label: "New customer ROAS", format: "multiple", value: (data, customer) => data.availability.marketingSpend && customer ? ratio(customer.newSales, data.metrics.marketingSpend) : "—" },
      { label: "New customers", format: "integer", value: (_, customer) => customerValue(customer, "newCustomers") },
      { label: "New customer sales", format: "currency", value: (_, customer) => customer ? customer.newSales : "—" },
      { label: "Profit per new customer", format: "currency", value: (data, customer) => data.availability.netProfit && data.metrics.netProfit !== null && customer ? ratio(data.metrics.netProfit, customer.newCustomers) : "—" },
      { label: "Repeat customers", format: "integer", value: (_, customer) => customerValue(customer, "repeatCustomers") },
      { label: "Repeat customer sales", format: "currency", value: (_, customer) => customer ? customer.repeatSales : "—" },
      { label: "Repeat orders", format: "percentage", value: (_, customer) => customer ? ratio(customer.repeatOrders, customer.newOrders + customer.repeatOrders) : "—" },
      { label: "Repeat sales", format: "percentage", value: (_, customer) => customer ? ratio(customer.repeatSales, customer.newSales + customer.repeatSales) : "—" },
    ] },
    { heading: "Orders", rows: [
      { label: "Orders", format: "integer", value: (data) => data.metrics.orders },
      { label: "Average order value", format: "currency", value: (data) => ratio(data.metrics.totalSales, data.metrics.orders) },
      { label: "New customer AOV", format: "currency", value: (_, customer) => customer ? ratio(customer.newSales, customer.newOrders) : "—" },
      { label: "Repeat customer AOV", format: "currency", value: (_, customer) => customer ? ratio(customer.repeatSales, customer.repeatOrders) : "—" },
      { label: "Average items per order", format: "decimal", value: (data) => data.metrics.orders > 0 ? (data.metrics.unitsSold / data.metrics.orders) : "—" },
    ] },
  ];

  const exportPnl = (format: "csv" | "xlsx" = "csv") => {
    if (!pnl?.hasData || loading || periodLoading) return;
    const columns = [...displayedColumns, ...(pnl.period ? [{ period: { ...pnl.period, label: "Total for period" }, data: pnl }] : [])];
    const groups: PnlExportGroup[] = sections.filter((section) => !collapsedSections.has(section)).map((section) => ({
      heading: section,
      rows: pnlRows.filter((row) => row.section === section).map((row) => ({
        label: row.label, format: "currency", values: columns.map((column) => row.value(column.data)),
      })),
    }));
    groups.push(...pnlKpiGroups.map((group) => ({
      heading: group.heading,
      rows: group.rows.map((row) => ({ label: row.label, format: row.format, values: [
        ...displayedColumns.map((column) => row.value(column.data, customerPeriodByRange.get(`${column.period.start}:${column.period.end}`) ?? null)),
        // The on-screen KPI table has no period-total column. Customer counts
        // across months can overlap, so these cells must not be summed.
        ...(pnl.period ? ["Not shown"] : []),
      ] })),
    })));
    const report = buildPnlExport({
      currency: pnl.currency, columns: columns.map((column) => column.period.label), groups,
      metadata: [
        ["Report", "Profit & Loss"],
        ["Period", pnl.period ? `${pnl.period.start} to ${pnl.period.end}` : "No imported orders"],
        ["Granularity", granularity],
        ["Comparison overlay", showComparison && comparison?.hasData ? "Previous period" : "Off"],
        ["Currency", pnl.currency], ["Timezone", pnl.timezone], ["Generated at", new Date().toISOString()],
        ["Reconciliation", reconciliationIssues.length ? reconciliationIssues.join("; ") : "Complete"],
        ["Visible sections", sections.filter((section) => !collapsedSections.has(section)).join(", ")],
        ["Total scope", "Income statement total covers the full selected period, excluding the comparison. KPI totals are not shown."],
        ["Customer metrics", customerPeriodError ? "Could not be loaded; unavailable values shown as —" : "— means no denominator or incomplete source coverage"],
      ],
    });
    if (format === "xlsx") downloadXlsx("profit-and-loss.xlsx", report.rows, report.options);
    else downloadCsv("profit-and-loss.csv", report.csvRows);
  };

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
    setPeriodPage(0);
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
      <label>From<input type="date" value={fromDate} onChange={(event) => { setDatePreset("custom"); setPeriodPage(0); setFromDate(event.target.value); }} /></label>
      <label>To<input type="date" value={toDate} onChange={(event) => { setDatePreset("custom"); setPeriodPage(0); setToDate(event.target.value); }} /></label>
      <label>Group by<select aria-label="P&L granularity" value={granularity} onChange={(event) => { setPeriodPage(0); setGranularity(event.target.value as ReportingGranularity); }}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
      <div className="segmented"><button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>Table</button><button className={viewMode === "chart" ? "active" : ""} onClick={() => setViewMode("chart")}>Chart</button></div>
      <label className="comparison-toggle"><input type="checkbox" checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)}/> Previous period</label>
    </section>
    {loading || periodLoading ? <PanelState status="loading" message="Calculating reconciled periods…"/> : null}
    {pnl.microsoftAdsImportError && !pnl.availability.bingMarketingSpend ? <div className="connection-notice"><Info/><div><strong>Microsoft Ads spend could not be imported</strong><span>{pnl.microsoftAdsImportError}</span></div></div> : null}
    {!pnl.hasData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to build your income statement</strong><span>Your period views will populate after the first sync.</span></div></div> : null}{pnl.currencyCoverage.convertedOrders ? <div className="connection-notice"><Info/><div><strong>{pnl.currencyCoverage.convertedOrders.toLocaleString()} orders converted in this P&amp;L</strong><span>Historical rates applied into {pnl.currency}: {pnl.currencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}.</span></div></div> : null}{pnl.currencyCoverage.excludedOrders ? <div className="connection-notice"><Info/><div><strong>{pnl.currencyCoverage.excludedOrders.toLocaleString()} orders excluded from this P&amp;L</strong><span>Reporting currency is {pnl.currency}. Excluded: {pnl.currencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.orders.toLocaleString()})`).join(", ")}. Spine never combines currencies without an explicit dated exchange rate.</span></div></div> : null}{pnl.marketingCurrencyCoverage.convertedRows ? <div className="connection-notice"><Info/><div><strong>{pnl.marketingCurrencyCoverage.convertedRows.toLocaleString()} advertising spend rows converted</strong><span>Historical rates applied into {pnl.currency}: {pnl.marketingCurrencyCoverage.convertedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}{pnl.marketingCurrencyCoverage.excludedRows ? <div className="connection-notice"><Info/><div><strong>{pnl.marketingCurrencyCoverage.excludedRows.toLocaleString()} advertising spend rows excluded</strong><span>Net profit stays provisional until dated rates exist for {pnl.marketingCurrencyCoverage.excludedCurrencies.map((item) => `${item.currency} (${item.rows.toLocaleString()})`).join(", ")}.</span></div></div> : null}
    {pnl.hasData && !pnl.availability.transactionFeesComplete ? <div className="connection-notice"><Info/><div><strong>Shopify payment fees need attention</strong><span>{pnl.transactionFeeCoverage?.reportedFeeDays ?? 0} of {pnl.transactionFeeCoverage?.salesDays ?? 0} sales days have imported fees. {pnl.transactionFeeCoverage?.latestReportedFeeDate ? `Latest fee date: ${pnl.transactionFeeCoverage.latestReportedFeeDate}.` : "No fees were returned for this period."} Net profit remains provisional until fees are covered.</span><button type="button" className="secondary-button" disabled={feeRefreshBusy} onClick={() => void refreshShopifyFees()}>{feeRefreshBusy ? "Refreshing Shopify fees…" : "Refresh Shopify fees"}</button>{feeRefreshStatus ? <small>{feeRefreshStatus}</small> : null}</div></div> : null}
    {pnl.hasData ? <div className="connection-notice"><Info/><div><strong>{reconciliationIssues.length ? "Reconciliation status: provisional" : "Reconciliation status: complete"}</strong><span>{reconciliationIssues.length ? reconciliationIssues.join(" · ") : "All required cost inputs are covered for this period."}</span></div></div> : null}
    {pnl.hasData ? <><div className="report-export" style={{ gap: 8, flexWrap: "wrap" }}><button className="export-button" disabled={loading || periodLoading} onClick={() => exportPnl("csv")}><Download/> Export visible P&amp;L CSV</button><button className="export-button" disabled={loading || periodLoading} onClick={() => exportPnl("xlsx")}><Download/> Export visible P&amp;L Excel</button></div><details className="metric-dictionary"><summary>Metric definitions</summary><dl><div><dt>Total sales</dt><dd>Net product sales plus customer shipping revenue. Tax and duties are shown separately.</dd></div><div><dt>Gross profit</dt><dd>Net product sales after refunds, less effective-dated product costs.</dd></div><div><dt>Net profit</dt><dd>Available after marketing, shipping, handling, product-cost, and operating-cost coverage is complete.</dd></div></dl></details></> : null}
    <section className="panel report-panel"><div className="report-summary">{summary.map(([label, value, hint]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
      {viewMode === "chart" && displayPeriods.length ? <div className="pnl-chart"><div className="panel-head"><div><span className="eyebrow">PROFIT TREND</span><h2>Revenue, gross profit, and net profit</h2></div><div className="legend"><span className="blue-dot"/>Net sales <span className="green-dot"/>Gross profit <span className="orange-dot"/>Net profit</div></div><div className="chart-wrap"><div className="y-axis"><span>{formatter.format(chartMaximum)}</span><span>{formatter.format(chartMaximum / 2)}</span><span>{formatter.format(chartMaximum / 4)}</span><span>{formatter.format(0)}</span></div><div className="bar-chart">{displayPeriods.map(({ period, data }) => <div className="bar-group" key={period.start + "-" + period.end}><div className="bars"><i className="revenue" style={{height:(Math.abs(data.metrics.netProductSales - data.metrics.refunds) / chartMaximum * 100) + "%"}}/><i className="profit" style={{height:(Math.abs(data.metrics.grossProfit) / chartMaximum * 100) + "%"}}/><i className="spend" style={{height:(Math.abs(data.metrics.netProfit ?? 0) / chartMaximum * 100) + "%"}}/></div><span>{period.label}</span></div>)}</div></div></div> : null}
      {viewMode === "table" ? <div className="table-scroll"><table className="data-table pnl-table period-table"><thead><tr><th>Income statement</th>{displayedColumns.map((column, index) => <th key={column.period.start + "-" + column.period.end + "-" + index}>{column.period.label}</th>)}{pnl?.period ? <th className="pnl-period-total">Full-period total</th> : null}</tr></thead><tbody>{sections.map((section) => [<tr className="pnl-section" key={section + "-heading"}><td colSpan={displayedColumns.length + (pnl?.period ? 2 : 1)}><button onClick={() => toggleSection(section)}><ChevronDown className={collapsedSections.has(section) ? "collapsed" : ""}/>{section}</button></td></tr>, ...(collapsedSections.has(section) ? [] : pnlRows.filter((row) => row.section === section).map((row) => <tr className={row.label.includes("profit") || row.label.includes("margin") || row.label === "Total sales" || row.label === "Total marketing spend" || row.label === "Total payment fees" || row.label === "Estimated external processor fees" ? "total" : ""} key={section + "-" + row.label}><td><span className="indent"><PnlRowTitle label={row.label}/></span></td>{displayedColumns.map((column, index) => <td key={row.label + "-" + index}>{formatPnlValue(row.value(column.data), "currency", pnl.currency)}</td>)}{pnl?.period ? <td className="pnl-period-total">{formatPnlValue(row.value(pnl), "currency", pnl.currency)}</td> : null}</tr>))])}</tbody></table></div> : null}
      <div className="table-footer"><span>Showing {periodWindow.periods[0]?.label ?? "—"} to {periodWindow.periods.at(-1)?.label ?? "—"} of {periodWindow.totalPeriods} {granularity} periods. Full-period total covers {pnl.period?.start} to {pnl.period?.end}.</span><span>{showComparison ? "Previous-period overlay on" : "Comparison overlay off"}</span></div>
      {periodWindow.pageCount > 1 ? <div className="pnl-period-navigation"><button type="button" disabled={periodWindow.page >= periodWindow.pageCount - 1 || periodLoading} onClick={() => setPeriodPage(periodWindow.page + 1)}>← Earlier periods</button><span>Page {periodWindow.page + 1} of {periodWindow.pageCount}</span><button type="button" disabled={periodWindow.page === 0 || periodLoading} onClick={() => setPeriodPage(periodWindow.page - 1)}>Later periods →</button></div> : null}
    </section>
    {pnl.hasData ? <section className="panel report-panel pnl-kpi-panel">
      <div className="panel-head"><div><span className="eyebrow">OPERATING METRICS</span><h2>Margins, acquisition and orders</h2><p>Calculated for the same periods as the income statement.</p></div></div>
      {customerPeriodError ? <div className="connection-notice"><Info/><div><strong>Customer metrics could not be loaded</strong><span>Margin and order metrics remain available. Refresh to retry customer metrics.</span></div></div> : null}
      <div className="table-scroll"><table className="data-table pnl-table period-table pnl-kpi-table"><thead><tr><th>Metric</th>{displayedColumns.map((column, index) => <th key={column.period.start + "-" + column.period.end + "-kpi-" + index}>{column.period.label}</th>)}</tr></thead><tbody>{pnlKpiGroups.map((group) => [<tr className="pnl-section" key={group.heading + "-heading"}><td colSpan={displayedColumns.length + 1}>{group.heading}</td></tr>, ...group.rows.map((row) => <tr key={group.heading + "-" + row.label}><td><span className="indent"><PnlRowTitle label={row.label}/></span></td>{displayedColumns.map((column, index) => <td key={row.label + "-" + index}>{formatPnlValue(row.value(column.data, customerPeriodByRange.get(`${column.period.start}:${column.period.end}`) ?? null), row.format, pnl.currency)}</td>)}</tr>)] )}</tbody></table></div>
      <div className="table-footer"><span>New = first valid imported order for an identified customer; repeat = later orders. Guest orders are excluded from the new/repeat split.</span><span>— means no denominator or incomplete source coverage.</span></div>
    </section> : null}
  </>;

  return <>{comparison?.hasData && pnl?.hasData ? <section className="cost-grid live pnl-comparison"><div><strong>{change(pnl.metrics.netProductSales, comparison.metrics.netProductSales) === null ? "—" : `${change(pnl.metrics.netProductSales, comparison.metrics.netProductSales)!.toFixed(1)}%`}</strong><span>Net product sales vs previous period</span></div><div><strong>{change(pnl.metrics.grossProfit, comparison.metrics.grossProfit) === null ? "—" : `${change(pnl.metrics.grossProfit, comparison.metrics.grossProfit)!.toFixed(1)}%`}</strong><span>Gross profit vs previous period</span></div><div><strong>{pnl.metrics.orders - comparison.metrics.orders >= 0 ? "+" : ""}{(pnl.metrics.orders - comparison.metrics.orders).toLocaleString()}</strong><span>Orders vs previous period</span></div></section> : null}{yearComparison?.hasData && pnl?.hasData ? <section className="cost-grid live pnl-comparison"><div><strong>{change(pnl.metrics.netProductSales, yearComparison.metrics.netProductSales) === null ? "—" : `${change(pnl.metrics.netProductSales, yearComparison.metrics.netProductSales)!.toFixed(1)}%`}</strong><span>Net product sales vs previous year</span></div><div><strong>{change(pnl.metrics.grossProfit, yearComparison.metrics.grossProfit) === null ? "—" : `${change(pnl.metrics.grossProfit, yearComparison.metrics.grossProfit)!.toFixed(1)}%`}</strong><span>Gross profit vs previous year</span></div><div><strong>{pnl.metrics.orders - yearComparison.metrics.orders >= 0 ? "+" : ""}{(pnl.metrics.orders - yearComparison.metrics.orders).toLocaleString()}</strong><span>Orders vs previous year</span></div></section> : null}<section className="filter-row pnl-period finance-date-controls"><label>Period<select aria-label="P&L date period" value={datePreset} onChange={(event) => applyPnlDatePreset(event.target.value as FinanceDatePreset)}><option value="last_7_days">Last 7 days (today)</option><option value="last_7_complete_days">Last 7 complete days</option><option value="last_30_days">Last 30 days (today)</option><option value="last_30_complete_days">Last 30 complete days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="all_imported">All imported data</option><option value="custom">Custom dates</option></select></label><label>From<input type="date" value={fromDate} onChange={(event) => { setDatePreset("custom"); setFromDate(event.target.value); }} /></label><label>To<input type="date" value={toDate} onChange={(event) => { setDatePreset("custom"); setToDate(event.target.value); }} /></label></section>{loading ? <PanelState status="loading" message="Calculating your income statement…"/> : loadError ? <PanelState status="error" title="Your income statement could not be loaded" message="Check your connection and try again." onRetry={() => setRetryToken((token) => token + 1)}/> : !hasLiveData && pnl ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to build your income statement</strong><span>Your reconciled sales and cost data will appear here after your first sync.</span></div></div> : null}{hasLiveData ? <div className="connection-notice"><Info/><div><strong>How this P&amp;L is calculated</strong><span>Total sales are net product sales plus shipping revenue. Gross profit is Shopify net product sales, less refunds and effective-dated product costs. Tax and duties are shown for reconciliation but excluded from profit. Operating expenses include your fixed, per-order, per-unit, and revenue-rate rules. Actual Shopify payment fees take priority; matching gateway rules estimate missing fees. Imported Meta and Google Ads spend is deducted when it overlaps the selected period. Fulfilment, handling, and pick/pack rules provide the remaining direct costs.</span></div></div> : null}{hasLiveData && pnl!.metrics.missingCostLines > 0 ? <div className="connection-notice"><Info/><div><strong>{pnl!.metrics.missingCostLines} order lines are missing a product cost</strong><span>Gross profit is provisional until you add an effective-dated product cost for these variants.</span></div></div> : null}{hasLiveData && pnl!.metrics.unallocatedOperatingCosts > 0 ? <div className="connection-notice"><Info/><div><strong>{pnl!.metrics.unallocatedOperatingCosts} operating costs still need an allocation rule</strong><span>The P&amp;L excludes these costs because their currency or effective dates need attention.</span></div></div> : null}{hasLiveData ? <><div className="report-export"><button className="export-button" disabled={loading || periodLoading} onClick={() => exportPnl("csv")}><Download/> Export P&amp;L CSV</button></div><details className="metric-dictionary"><summary>Metric definitions</summary><dl><div><dt>Total sales</dt><dd>Net product sales plus customer shipping revenue. Tax and duties are shown separately.</dd></div><div><dt>Gross profit</dt><dd>Net product sales after refunds, less effective-dated product costs. It is marked provisional when a line has no cost.</dd></div><div><dt>Profit after known costs</dt><dd>Gross profit less payment fees, merchant shipping, handling, pick/pack, fixed operating costs, and variable operating costs available to Spine.</dd></div><div><dt>Profit after marketing spend</dt><dd>Profit after known costs less imported Meta and Google Ads spend in the selected period.</dd></div><div><dt>Net profit</dt><dd>Available only after marketing, merchant shipping, handling, product costs, and operating-cost coverage are complete.</dd></div></dl></details></> : null}<section className="panel report-panel"><div className="report-summary">{loading ? Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton style={{ width: "60%", height: 9 }}/><Skeleton style={{ width: "70%", height: 20, marginTop: 9 }}/><Skeleton style={{ width: "50%", height: 9, marginTop: 9 }}/></div>) : summary.map(([label, value, hint])=><div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div><div className="table-scroll"><table className="data-table pnl-table"><thead><tr><th>Income statement</th><th>{pnl?.period ? `${pnl.period.start} to ${pnl.period.end}` : "Selected period"}</th></tr></thead><tbody>{loading ? Array.from({ length: 10 }, (_, index) => <TableRowSkeleton key={index} columns={2}/>) : liveRows.map((row,index)=><tr className={totalRows.has(index)?"total":""} key={row[0]}>{row.map((cell,i)=><td key={`${cell}-${i}`}>{i===0 && !totalRows.has(index)?<span className="indent"><PnlRowTitle label={cell}/></span>:cell}</td>)}</tr>)}</tbody></table></div></section></>;
}
