import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { convertDatedAmount, createCurrencyConversionCoverage, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";
import { calculateAcquisitionMetrics } from "@/lib/analytics/acquisition";
import { classifyCustomerOrders } from "@/lib/analytics/customer-classification";
import { reportingDateKey, reportingMonthKey, reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { refreshReportingData } from "@/lib/analytics/reporting-refresh";

type Order = {
  id: string;
  customer_id: string | null;
  processed_at: string | null;
  gross_sales: string;
  discounts: string;
  net_product_sales: string;
  shipping_revenue: string;
  total_sales: string;
  currency: string;
  exchange_rate: number;
};

type ShopifyDaily = {
  sales_date: string; gross_sales: string; discounts: string; net_sales: string; shipping_charges: string;
  orders: number; net_items_sold: number;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: timezone }).format(date);
}

/**
 * Financial calculations stay on the server. All imported orders contribute to
 * the headline totals; the chart displays the six latest months in the store.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if ((fromDate && !isDate(fromDate)) || (toDate && !isDate(toDate)) || (fromDate && toDate && fromDate > toDate)) {
    return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });
  }
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  if (fromDate && toDate) {
    try {
      await refreshReportingData(supabase, store, fromDate, toDate);
    } catch (error) {
      console.warn("Reporting refresh was skipped; returning saved report data", {
        source: "overview",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  let dailyQuery = supabase.from("shopify_sales_daily")
    .select("sales_date,gross_sales,discounts,net_sales,shipping_charges,orders,net_items_sold")
    .eq("store_id", store.id).order("sales_date", { ascending: true });
  if (fromDate) dailyQuery = dailyQuery.gte("sales_date", fromDate);
  if (toDate) dailyQuery = dailyQuery.lte("sales_date", toDate);
  const { data: dailyRowsData, error: dailyRowsError } = await dailyQuery;
  if (dailyRowsError) return NextResponse.json({ error: dailyRowsError.message }, { status: 500 });
  const dailyRows = (dailyRowsData ?? []) as ShopifyDaily[];
  const timezone = store.timezone || "UTC";

  if (dailyRows.length) {
    const rangeStart = fromDate || dailyRows[0].sales_date;
    const rangeEnd = toDate || dailyRows.at(-1)!.sales_date;
    const [metaResult, googleResult, acquisitionResult] = await Promise.all([
      supabase.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).gte("date_start", rangeStart).lte("date_start", rangeEnd),
      supabase.from("google_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", rangeStart).lte("insight_date", rangeEnd),
      supabase.from("shopify_acquisition_daily").select("new_customers,new_customer_sales,currency").eq("store_id", store.id).gte("sales_date", rangeStart).lte("sales_date", rangeEnd),
    ]);
    const spendError = metaResult.error ?? googleResult.error ?? acquisitionResult.error;
    if (spendError) return NextResponse.json({ error: spendError.message }, { status: 500 });
    const monthMap = new Map<string, { key: string; label: string; grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number }>();
    let grossSales = 0, discounts = 0, netSales = 0, shippingRevenue = 0, orderCount = 0, unitsSold = 0;
    for (const row of dailyRows) {
      const key = row.sales_date.slice(0, 7);
      const date = new Date(`${key}-01T00:00:00Z`);
      const month = monthMap.get(key) ?? { key, label: monthLabel(date, store.timezone || "UTC"), grossSales: 0, discounts: 0, netSales: 0, shippingRevenue: 0, orders: 0 };
      const gross = Number(row.gross_sales) || 0;
      const discount = Math.abs(Number(row.discounts) || 0);
      const net = Number(row.net_sales) || 0;
      const shipping = Number(row.shipping_charges) || 0;
      grossSales += gross; discounts += discount; netSales += net; shippingRevenue += shipping;
      orderCount += row.orders || 0; unitsSold += row.net_items_sold || 0;
      month.grossSales += gross; month.discounts += discount; month.netSales += net; month.shippingRevenue += shipping; month.orders += row.orders || 0;
      monthMap.set(key, month);
    }
    const marketingSpend = [...(metaResult.data ?? []).map((row) => ({ spend: row.spend, currency: row.currency })), ...(googleResult.data ?? []).map((row) => ({ spend: row.spend, currency: row.currency }))]
      .reduce((total, row) => row.currency === store.currency ? total + (Number(row.spend) || 0) : total, 0);
    const metaDates = (metaResult.data ?? []).map((row) => row.date_start).sort();
    const googleDates = (googleResult.data ?? []).map((row) => row.insight_date).sort();

    // ShopifyQL tracks first purchases using the same dates as the sales summary.
    // That stays accurate even when detailed orders were imported only for an older window.
    const acquisitionRows = acquisitionResult.data ?? [];
    const newCustomers = acquisitionRows.reduce((total, row) => row.currency === store.currency ? total + Math.max(0, Number(row.new_customers) || 0) : total, 0);
    const newCustomerSales = acquisitionRows.reduce((total, row) => row.currency === store.currency ? total + (Number(row.new_customer_sales) || 0) : total, 0);
    const acquisition = calculateAcquisitionMetrics({ netSales, newCustomerSales, marketingSpend, newCustomers });
    return NextResponse.json({
      hasData: true, currency: store.currency, timezone,
      currencyCoverage: { reportingCurrency: store.currency, includedOrders: orderCount, convertedOrders: 0, excludedOrders: 0, convertedCurrencies: [], excludedCurrencies: [] },
      marketingCurrencyCoverage: { reportingCurrency: store.currency, includedRows: metaDates.length + googleDates.length, convertedRows: 0, excludedRows: 0, convertedCurrencies: [], excludedCurrencies: [] },
      range: { start: rangeStart, end: rangeEnd },
      metrics: { grossSales, discounts, netSales, shippingRevenue, orders: orderCount, unitsSold, averageOrderValue: orderCount ? netSales / orderCount : 0, marketingSpend, newCustomers, newCustomerSales, ...acquisition },
      months: [...monthMap.values()].slice(-12),
      meta: { importedDays: metaDates.length, start: metaDates[0] ?? null, end: metaDates.at(-1) ?? null },
      google: { importedDays: googleDates.length, start: googleDates[0] ?? null, end: googleDates.at(-1) ?? null },
    });
  }

  const { data: exchangeRateRows, error: exchangeRateError } = await supabase
    .from("exchange_rates")
    .select("base_currency,quote_currency,rate,effective_date")
    .eq("store_id", store.id)
    .eq("quote_currency", store.currency)
    .order("effective_date", { ascending: true });
  if (exchangeRateError) return NextResponse.json({ error: exchangeRateError.message }, { status: 500 });
  const exchangeRates = (exchangeRateRows ?? []) as DatedExchangeRate[];
  const dateRange = fromDate && toDate ? reportingRangeToUtc(fromDate, toDate, timezone) : null;
  const orders: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("shopify_orders")
      .select("id,customer_id,processed_at,gross_sales,discounts,net_product_sales,shipping_revenue,total_sales,currency")
      .eq("store_id", store.id)
      .is("cancelled_at", null)
      .eq("test", false)
      .not("processed_at", "is", null);
    if (dateRange) query = query.gte("processed_at", dateRange.start).lt("processed_at", dateRange.endExclusive);
    else {
      if (fromDate) query = query.gte("processed_at", reportingRangeToUtc(fromDate, fromDate, timezone).start);
      if (toDate) query = query.lt("processed_at", reportingRangeToUtc(toDate, toDate, timezone).endExclusive);
    }
    const { data, error } = await query.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Array<Omit<Order, "exchange_rate">>;
    for (const order of page) {
      const exchangeRate = resolveDatedExchangeRate(exchangeRates, order.currency, store.currency, order.processed_at ?? "");
      if (currencyCoverage.include(order.currency, exchangeRate)) orders.push({ ...order, exchange_rate: exchangeRate ?? 1 });
    }
    if (page.length < pageSize) break;
  }

  const latestOrderAt = orders.reduce<string | null>((latest, order) => !latest || (order.processed_at && order.processed_at > latest) ? order.processed_at : latest, null);
  const earliestOrderAt = orders[0]?.processed_at ?? null;
  const fallbackEnd = toDate ? new Date(`${toDate}T12:00:00.000Z`) : new Date();
  const latestLocalDate = reportingDateKey(latestOrderAt ?? fallbackEnd, timezone);
  const [latestYear, latestMonth] = latestLocalDate.slice(0, 7).split("-").map(Number);
  const chartEnd = new Date(Date.UTC(latestYear, latestMonth - 1, 1));
  const chartStart = new Date(Date.UTC(latestYear, latestMonth - 6, 1));
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(chartEnd.getUTCFullYear(), chartEnd.getUTCMonth() - (5 - index), 1));
    return { key: date.toISOString().slice(0, 7), label: monthLabel(date, store.timezone || "UTC"), grossSales: 0, discounts: 0, netSales: 0, shippingRevenue: 0, orders: 0 };
  });
  const periods = new Map(months.map((month) => [month.key, month]));
  let grossSales = 0;
  let discounts = 0;
  let netSales = 0;
  let shippingRevenue = 0;
  let newCustomerSales = 0;
  const classificationOrders: Array<{ id: string; customerId: string | null; processedAt: string | null }> = [];
  for (let from = 0; ; from += pageSize) {
    let historyQuery = supabase.from("shopify_orders").select("id,customer_id,processed_at").eq("store_id", store.id).is("cancelled_at", null).eq("test", false).not("processed_at", "is", null);
    if (toDate) historyQuery = historyQuery.lt("processed_at", reportingRangeToUtc(toDate, toDate, timezone).endExclusive);
    const { data, error } = await historyQuery.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = data ?? [];
    classificationOrders.push(...page.map((order) => ({ id: order.id, customerId: order.customer_id, processedAt: order.processed_at })));
    if (page.length < pageSize) break;
  }
  const customerClasses = classifyCustomerOrders(classificationOrders);

  for (const order of orders) {
    if (!order.processed_at) continue;
    const key = reportingMonthKey(order.processed_at, timezone);
    const period = periods.get(key);
    const gross = convertDatedAmount(Number(order.gross_sales) || 0, order.exchange_rate, store.currency);
    const discount = convertDatedAmount(Number(order.discounts) || 0, order.exchange_rate, store.currency);
    const net = convertDatedAmount(Number(order.net_product_sales) || 0, order.exchange_rate, store.currency);
    const shipping = convertDatedAmount(Number(order.shipping_revenue) || 0, order.exchange_rate, store.currency);
    grossSales += gross;
    discounts += discount;
    netSales += net;
    shippingRevenue += shipping;
    if (customerClasses.get(order.id) === "new") newCustomerSales += net;
    if (period) {
      period.grossSales += gross;
      period.discounts += discount;
      period.netSales += net;
      period.shippingRevenue += shipping;
      period.orders += 1;
    }
  }

  let metaQuery = supabase.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).order("date_start", { ascending: true });
  if (fromDate) metaQuery = metaQuery.gte("date_start", fromDate);
  else if (earliestOrderAt) metaQuery = metaQuery.gte("date_start", earliestOrderAt.slice(0, 10));
  if (toDate) metaQuery = metaQuery.lte("date_start", toDate);
  else if (latestOrderAt) metaQuery = metaQuery.lte("date_start", latestOrderAt.slice(0, 10));
  const { data: metaRows, error: metaError } = await metaQuery;
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 500 });
  const orderCount = orders.length;
  const includedOrderIds = new Set(orders.map((order) => order.id));
  let unitsSold = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("shopify_order_lines").select("order_id,current_quantity").eq("store_id", store.id).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const line of data ?? []) if (includedOrderIds.has(line.order_id)) unitsSold += Math.max(line.current_quantity, 0);
    if ((data ?? []).length < pageSize) break;
  }
  const metaDates = (metaRows ?? []).map((row) => row.date_start);
  const marketingCurrencyCoverage = createCurrencyConversionCoverage(store.currency);
  const marketingSpend = (metaRows ?? []).reduce((total, row) => {
    const exchangeRate = resolveDatedExchangeRate(exchangeRates, row.currency, store.currency, row.date_start);
    if (!marketingCurrencyCoverage.include(row.currency, exchangeRate)) return total;
    return total + convertDatedAmount(Number(row.spend) || 0, exchangeRate ?? 1, store.currency);
  }, 0);
  const newCustomers = [...customerClasses.values()].filter((classification) => classification === "new").length;
  const acquisition = calculateAcquisitionMetrics({ netSales, newCustomerSales, marketingSpend, newCustomers });
  return NextResponse.json({
    hasData: orderCount > 0,
    currency: store.currency,
    timezone,
    currencyCoverage: currencyCoverage.summary(),
    marketingCurrencyCoverage: marketingCurrencyCoverage.summary(),
    range: { start: fromDate || (earliestOrderAt ? reportingDateKey(earliestOrderAt, timezone) : isoDate(chartStart)), end: toDate || (latestOrderAt ? reportingDateKey(latestOrderAt, timezone) : latestLocalDate) },
    metrics: {
      grossSales,
      discounts,
      netSales,
      shippingRevenue,
      orders: orderCount,
      unitsSold,
      averageOrderValue: orderCount ? netSales / orderCount : 0,
      marketingSpend,
      newCustomers,
      newCustomerSales,
      ...acquisition,
    },
    months,
    meta: { importedDays: metaDates.length, start: metaDates[0] ?? null, end: metaDates.at(-1) ?? null },
  });
}

