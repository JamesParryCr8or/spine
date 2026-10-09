"use client";

import { useCallback, useEffect, useState } from "react";
import { StatCardSkeleton } from "@/components/ui/skeleton";
import { reportingPeriods, type ReportingGranularity } from "@/lib/analytics/reporting-periods";
import { buildCampaignUrl } from "@/lib/analytics/utm-builder";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { buildCustomSpendRows, customSpendColumnFields, parseCustomSpendCsv, type CustomSpendColumnKey, type ParsedCustomSpendCsv, type CustomSpendInputRow } from "@/lib/settings/custom-spend-csv";
import { Download, Info, Plus, Search, Trash2 } from "lucide-react";
import { type DrilldownContext, type FinanceDatePreset, financeDateRange, FinanceDateControls, downloadCsv, useReportRun, type PnlData, pnlSeriesKey, fetchPnlSeries, type UtmData } from "@/components/analytics/shared";
import { PanelState } from "@/components/ui/panel-state";

type CustomSpendBatch = { id: string; original_filename: string; row_count: number; inserted_count: number; updated_count: number; rolled_back_at: string | null; created_at: string };

type CampaignMappingRow = { id: string; platform: "meta"; external_campaign_id: string; external_campaign_name: string; utm_source: string; utm_medium: string; utm_campaign: string; updated_at: string };

type CampaignMappingData = { canManage: boolean; mappings: CampaignMappingRow[]; campaigns: Array<{ campaign_id: string; campaign_name: string; account_id: string; account_name: string | null; currency: string }> };

export function UTMAnalysis({ reportRunId, initialRange }: { reportRunId?: string; initialRange?: DrilldownContext }) {
  const finishReportRun = useReportRun(reportRunId);
  const [data, setData] = useState<UtmData | null>(null);
  const [profitData, setProfitData] = useState<PnlData | null>(null);
  const [comparisonData, setComparisonData] = useState<UtmData | null>(null);
  const [profitTrends, setProfitTrends] = useState<{ current: Array<{ label: string; value: number }>; previous: Array<{ label: string; value: number }> }>({ current: [], previous: [] });
  const [trendMetric, setTrendMetric] = useState<"sales" | "orders" | "customers" | "profit">("sales");
  const [trendLoading, setTrendLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
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
  useResetOnChange(`${attributionModel}|${fromDate}|${toDate}|${country}|${product}|${groupBy}|${mappingRevision}|${retryToken}`, () => { setLoading(true); setLoadError(false); });
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
    ]).then(([payload, profit]) => { setData(payload); setProfitData(profit); setLoadError(!payload); finishReportRun(payload ? "completed" : "failed", payload?.rows.length ?? null); }).catch(() => { setData(null); setProfitData(null); setLoadError(true); finishReportRun("failed", null, "UTM data could not be loaded"); }).finally(() => setLoading(false));
  }, [attributionModel, fromDate, toDate, country, product, groupBy, mappingRevision, finishReportRun, retryToken]);

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
        // One request for both lines. A failure clears the chart rather than
        // drawing missing periods as zero profit.
        fetchPnlSeries([...currentPeriods, ...previousPeriods], controller.signal).then((series) => {
          const profit = (periods: typeof currentPeriods) => periods.flatMap((period) => {
            const payload = series.get(pnlSeriesKey(period));
            return payload ? [{ label: period.label, value: payload.metrics.netProfit ?? payload.metrics.profitAfterMarketingSpend }] : [];
          });
          return [profit(currentPeriods), profit(previousPeriods)] as const;
        }),
      ]).then(([comparison, [currentProfit, previousProfit]]) => { setComparisonData(comparison); setProfitTrends({ current: currentProfit, previous: previousProfit }); }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") { setComparisonData(null); setProfitTrends({ current: [], previous: [] }); } }).finally(() => { if (!controller.signal.aborted) setTrendLoading(false); });
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
  ] : [];
  const baseRows = data?.hasData ? data.rows : [];
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
    {loading ? <PanelState status="loading" message="Loading Shopify attribution…"/> : loadError ? <PanelState status="error" title="UTM attribution could not be loaded" message="Check your connection and try again." onRetry={() => setRetryToken((token) => token + 1)}/> : data && !data.hasData ? <div className="connection-notice"><Info/><div><strong>Shopify attribution will appear after an order sync</strong><span>This report uses the selected Shopify customer journey model.</span></div></div> : null}
    <section className="metric-grid compact">{loading ? Array.from({ length: 7 }, (_, index) => <StatCardSkeleton key={index}/>) : metrics.map(([label, value, hint]) => <article className="metric-card" key={label}><div className="metric-head"><span>{label}</span></div><strong>{value}</strong><div className="metric-foot"><span>{hint}</span></div></article>)}</section>
    {trendLabels.length ? <section className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">MONTHLY TREND</span><h2>{trendMetric === "sales" ? "Net sales" : trendMetric === "orders" ? "Orders" : trendMetric === "customers" ? "Customers" : "Profit"} versus previous period</h2></div><div className="feature-actions"><div className="legend"><span className="blue-dot"/>Current <span className="green-dot"/>{comparisonMode === "previous_year" ? "Previous year" : "Previous period"}</div><select aria-label="UTM trend metric" value={trendMetric} onChange={(event) => setTrendMetric(event.target.value as "sales" | "orders" | "customers" | "profit")}><option value="sales">Net sales</option><option value="orders">Orders</option><option value="customers">Customers</option><option value="profit" disabled={dimensionFiltered}>Profit</option></select></div></div>{trendLoading ? <PanelState status="loading" message="Calculating period comparison…"/> : <div className="chart-wrap"><div className="y-axis"><span>{formatTrendValue(trendMaximum)}</span><span>{formatTrendValue(trendMaximum / 2)}</span><span>{formatTrendValue(trendMaximum / 4)}</span><span>{formatTrendValue(0)}</span></div><div className="bar-chart">{trendLabels.map((label, index) => <div className="bar-group" key={`${label}-${index}`} title={`Current ${formatTrendValue(currentTrendValues[index] ?? 0)} · Previous ${formatTrendValue(previousTrendValues[index] ?? 0)}`}><div className="bars"><i className="revenue" style={{height:`${Math.max(currentTrendValues[index] ?? 0, 0) / trendMaximum * 100}%`}}/><i className="profit" style={{height:`${Math.max(previousTrendValues[index] ?? 0, 0) / trendMaximum * 100}%`}}/></div><span>{label}</span></div>)}</div></div>}</section> : null}
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
