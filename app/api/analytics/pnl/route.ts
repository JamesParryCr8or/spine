import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { convertDatedAmount, createCurrencyConversionCoverage, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";
import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { estimatedTransactionFee, reconcileDailyTransactionFees, selectEffectivePaymentFeeRule, type EffectivePaymentFeeRule, type ShopifyTransactionFee } from "@/lib/analytics/transaction-fees";
import { calculateExternalPaymentFees, isExternalProcessor, type GatewayPaymentDay, type PaymentEstimateSettings } from "@/lib/analytics/external-payment-fees";
import { allocatePeriodCost, operatingCostBucket } from "@/lib/analytics/cost-allocation";
import { selectEffectiveShippingCost, summarizeShippingCoverage, type ProductShippingCost, type ShippingCoverage } from "@/lib/analytics/shipping-cost";
import { reportingDateKey, reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { calculateProfitAndLoss } from "@/lib/analytics/profit-and-loss";
import { selectAllPages } from "@/lib/supabase/select-all";
import { selectOrdersByProcessedAt } from "@/lib/supabase/select-orders";

export const maxDuration = 60;

type Order = { id: string; processed_at: string | null; gross_sales: string; discounts: string; net_product_sales: string; shipping_revenue: string; tax: string; duties: string; total_sales: string; currency: string; exchange_rate: number };
type Line = { order_id: string; variant_gid: string | null; sku: string | null; current_quantity: number; net_sales: string };
type Variant = { id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Refund = { order_id: string; total_refunded: string };
type Transaction = ShopifyTransactionFee & { order_id: string; gateway: string | null; amount: string; processed_at_shopify: string | null; created_at_shopify: string };
type PaymentFeeRuleRow = { gateway: string; percentage_rate: string; fixed_fee: string; tax_rate: string; minimum_fee: string; currency: string; effective_from: string; effective_to: string | null };
type ProductShippingCostRow = ProductShippingCost & { currency: string };
type StoreCostDefault = { fulfilment_amount: string; fulfilment_basis: "orders" | "units"; postage_amount: string; postage_basis: "orders" | "units"; default_cogs_percent: string; currency: string };
type CustomCost = { name: string; category: string; amount: string; currency: string; cadence: "one_off" | "daily" | "weekly" | "monthly" | "annual"; allocation_basis: "fixed" | "orders" | "units" | "revenue"; effective_from: string; effective_to: string | null };
type MetaInsight = { date_start: string; spend: string; currency: string };
type GoogleInsight = { insight_date: string; spend: string; currency: string };
type ShopifyDaily = {
  sales_date: string; gross_sales: string; discounts: string; sales_reversals: string;
  net_sales: string; shipping_charges: string; taxes: string; total_sales: string;
  orders: number; net_items_sold: number; total_payment_fees: string; cost_of_goods_sold: string; net_sales_without_cost_recorded: string;
};

const dayMs = 24 * 60 * 60 * 1000;
const utcDay = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
const dayCountInclusive = (from: string, to: string) => Math.floor((utcDay(to) - utcDay(from)) / dayMs) + 1;
const laterDate = (left: string, right: string) => left > right ? left : right;
const earlierDate = (left: string, right: string) => left < right ? left : right;
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/**
 * Merges one page from each order-id chunk's query into the single page
 * shape selectAllPages() expects, surfacing the first chunk error if any.
 */
function mergeChunkPages<T>(chunkPages: Array<{ data: T[] | null; error: { message: string } | null }>) {
  const error = chunkPages.find((page) => page.error)?.error ?? null;
  if (error) return { data: null, error };
  return { data: chunkPages.flatMap((page) => page.data ?? []), error: null };
}

/**
 * P&L contains every imported valid Shopify order. Fees are only included
 * when Shopify supplied actual transaction-fee records. Effective gateway
 * rules estimate fees only for successful transactions without an actual fee.
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
  const dateRange = fromDate && toDate ? reportingRangeToUtc(fromDate, toDate, store.timezone || "UTC") : null;

  const pageSize = 1000;
  const shopifyDaily: ShopifyDaily[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let dailyQuery = supabase
      .from("shopify_sales_daily")
      .select("sales_date,gross_sales,discounts,sales_reversals,net_sales,shipping_charges,taxes,total_sales,orders,net_items_sold,total_payment_fees,cost_of_goods_sold,net_sales_without_cost_recorded")
      .eq("store_id", store.id)
      .order("sales_date", { ascending: true });
    if (fromDate) dailyQuery = dailyQuery.gte("sales_date", fromDate);
    if (toDate) dailyQuery = dailyQuery.lte("sales_date", toDate);
    const { data, error } = await dailyQuery.range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as ShopifyDaily[];
    shopifyDaily.push(...page);
    if (page.length < pageSize) break;
  }


  const { data: exchangeRateRows, error: exchangeRateError } = await supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true });
  if (exchangeRateError) return NextResponse.json({ error: exchangeRateError.message }, { status: 500 });
  const exchangeRates = (exchangeRateRows ?? []) as DatedExchangeRate[];
  const includedOrders: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  const { rows: validOrders, error: ordersError } = await selectOrdersByProcessedAt<Omit<Order, "exchange_rate">>((cursor, limit) => {
    let query = supabase
      .from("shopify_orders")
      .select("id,processed_at,gross_sales,discounts,net_product_sales,shipping_revenue,tax,duties,total_sales,currency")
      .eq("store_id", store.id)
      .is("cancelled_at", null)
      .eq("test", false)
      .not("processed_at", "is", null);
    if (dateRange) query = query.gte("processed_at", dateRange.start).lt("processed_at", dateRange.endExclusive);
    else {
      if (fromDate) query = query.gte("processed_at", reportingRangeToUtc(fromDate, fromDate, store.timezone || "UTC").start);
      if (toDate) query = query.lt("processed_at", reportingRangeToUtc(toDate, toDate, store.timezone || "UTC").endExclusive);
    }
    if (cursor) query = query.or(`processed_at.gt.${cursor.processedAt},and(processed_at.eq.${cursor.processedAt},id.gt.${cursor.id})`);
    return query.order("processed_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  }, pageSize);
  if (ordersError) return NextResponse.json({ error: ordersError }, { status: 500 });
  for (const order of validOrders) {
    const exchangeRate = resolveDatedExchangeRate(exchangeRates, order.currency, store.currency, order.processed_at ?? "");
    if (currencyCoverage.include(order.currency, exchangeRate)) includedOrders.push({ ...order, exchange_rate: exchangeRate ?? 1 });
  }
  const orderIds = includedOrders.map((order) => order.id);
  const orderChunks = chunks(orderIds, 500);

  const [lineResult, refundResult, transactionResult, variantResult, costResult, operatingCostResult, paymentFeeRuleResult, productShippingCostResult, storeCostDefaultResult, estimateSettingsResult] = await Promise.all([
    selectAllPages<Line>((range) => Promise.all(orderChunks.map((ids) => supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,current_quantity,net_sales").in("order_id", ids).order("id", { ascending: true }).range(range.from, range.to))).then(mergeChunkPages)),
    selectAllPages<Refund>((range) => Promise.all(orderChunks.map((ids) => supabase.from("shopify_refunds").select("order_id,total_refunded").in("order_id", ids).order("id", { ascending: true }).range(range.from, range.to))).then(mergeChunkPages)),
    selectAllPages<Transaction>((range) => Promise.all(orderChunks.map((ids) => supabase.from("shopify_transactions").select("order_id,fee_amount,fee_tax,currency,status,gateway,amount,processed_at_shopify,created_at_shopify").in("order_id", ids).order("id", { ascending: true }).range(range.from, range.to))).then(mergeChunkPages)),
    selectAllPages<Variant>((range) => supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<EffectiveCost>((range) => supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<CustomCost>((range) => supabase.from("custom_costs").select("name,category,amount,currency,cadence,allocation_basis,effective_from,effective_to").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<PaymentFeeRuleRow>((range) => supabase.from("payment_fee_rules").select("gateway,percentage_rate,fixed_fee,tax_rate,minimum_fee,currency,effective_from,effective_to").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<ProductShippingCostRow>((range) => supabase.from("product_shipping_costs").select("id,variant_id,sku,amount,allocation_basis,currency,effective_from,effective_to").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
    supabase.from("store_cost_defaults").select("fulfilment_amount,fulfilment_basis,postage_amount,postage_basis,default_cogs_percent,currency").eq("store_id", store.id).maybeSingle(),
    supabase.from("payment_fee_estimate_settings").select("shopify_plan,plan_override,default_percentage_rate,default_fixed_fee,surcharge_rate_override").eq("store_id", store.id).maybeSingle(),
  ]);
  const pagedResults = [lineResult, refundResult, transactionResult, variantResult, costResult, operatingCostResult, paymentFeeRuleResult, productShippingCostResult];
  const pagedError = pagedResults.find((result) => result.error)?.error;
  if (pagedError) return NextResponse.json({ error: pagedError }, { status: 500 });
  if (storeCostDefaultResult.error) return NextResponse.json({ error: storeCostDefaultResult.error.message }, { status: 500 });
  if (estimateSettingsResult.error) return NextResponse.json({ error: estimateSettingsResult.error.message }, { status: 500 });
  const lines = lineResult.rows;
  const refundsRows = refundResult.rows;
  const transactions = transactionResult.rows;

  const variantsByGid = new Map(variantResult.rows.map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(variantResult.rows.filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of costResult.rows) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }
  const ordersById = new Map(includedOrders.map((order) => [order.id, order]));
  const shippingCostsByKey = new Map<string, ProductShippingCost[]>();
  for (const cost of productShippingCostResult.rows) {
    if (cost.currency !== store.currency) continue;
    const key = costKey(cost);
    if (key) shippingCostsByKey.set(key, [...(shippingCostsByKey.get(key) ?? []), cost]);
  }
  const shippingRuleByLine = new Map<Line, ProductShippingCost>();
  const chargedOrderRules = new Set<string>();
  let variantShippingCosts = 0;
  for (const line of lines) {
    const order = ordersById.get(line.order_id);
    if (!order?.processed_at) continue;
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const rules = variant ? shippingCostsByKey.get(`variant:${variant.id}`) ?? shippingCostsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : shippingCostsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const rule = selectEffectiveShippingCost(rules, order.processed_at.slice(0, 10));
    if (!rule) continue;
    shippingRuleByLine.set(line, rule);
    if (rule.allocation_basis === "units") variantShippingCosts += monetary(rule.amount) * Math.max(line.current_quantity, 0);
    else {
      const chargeKey = `${line.order_id}:${rule.id}`;
      if (!chargedOrderRules.has(chargeKey)) { variantShippingCosts += monetary(rule.amount); chargedOrderRules.add(chargeKey); }
    }
  }

  const storeCostDefault = storeCostDefaultResult.data as StoreCostDefault | null;
  const usableStoreCostDefault = storeCostDefault?.currency === store.currency ? storeCostDefault : null;
  const dailyOrderCount = shopifyDaily.reduce((total, day) => total + Math.max(day.orders, 0), 0);
  const dailyUnitCount = shopifyDaily.reduce((total, day) => total + Math.max(day.net_items_sold, 0), 0);
  const uncoveredShippingLines = lines.filter((line) => !shippingRuleByLine.has(line));
  const uncoveredShippingOrderCount = lines.length ? new Set(uncoveredShippingLines.map((line) => line.order_id)).size : dailyOrderCount;
  const uncoveredShippingUnits = lines.length ? uncoveredShippingLines.reduce((total, line) => total + Math.max(line.current_quantity, 0), 0) : dailyUnitCount;
  const defaultPostageCosts = usableStoreCostDefault
    ? monetary(usableStoreCostDefault.postage_amount) * (usableStoreCostDefault.postage_basis === "orders" ? uncoveredShippingOrderCount : uncoveredShippingUnits)
    : 0;
  const totalOrderUnits = lines.length ? lines.reduce((total, line) => total + Math.max(line.current_quantity, 0), 0) : dailyUnitCount;
  const reportOrderCount = includedOrders.length || dailyOrderCount;
  const defaultFulfilmentCosts = usableStoreCostDefault
    ? monetary(usableStoreCostDefault.fulfilment_amount) * (usableStoreCostDefault.fulfilment_basis === "orders" ? reportOrderCount : totalOrderUnits)
    : 0;

  const defaultProductCogsRate = usableStoreCostDefault && monetary(usableStoreCostDefault.default_cogs_percent) > 0 ? monetary(usableStoreCostDefault.default_cogs_percent) / 100 : null;
  let cogs = 0;
  let missingCostLines = 0;
  for (const line of lines) {
    const order = ordersById.get(line.order_id);
    if (!order?.processed_at) continue;
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const costs = variant ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, order.processed_at.slice(0, 10), variant?.shopify_unit_cost === null || variant?.shopify_unit_cost === undefined ? null : monetary(variant.shopify_unit_cost));
    if (unitCost !== null) cogs += unitCost * Math.max(line.current_quantity, 0);
    else if (defaultProductCogsRate !== null) cogs += monetary(line.net_sales) * defaultProductCogsRate;
    else missingCostLines += 1;
  }

  if (shopifyDaily.length && includedOrders.length === 0) {
    const recordedCogs = shopifyDaily.reduce((total, day) => total + monetary(day.cost_of_goods_sold), 0);
    const uncostedSales = shopifyDaily.reduce((total, day) => total + Math.max(monetary(day.net_sales_without_cost_recorded), 0), 0);
    cogs = recordedCogs + (defaultProductCogsRate === null ? 0 : uncostedSales * defaultProductCogsRate);
    if (uncostedSales > 0 && defaultProductCogsRate === null) missingCostLines = 1;
  }

  const convertedOrderAmount = (order: Order, value: string) => convertDatedAmount(monetary(value), order.exchange_rate, store.currency);
  const importedTotals = includedOrders.reduce((total, order) => ({
    grossSales: total.grossSales + convertedOrderAmount(order, order.gross_sales),
    discounts: total.discounts + convertedOrderAmount(order, order.discounts),
    netProductSales: total.netProductSales + convertedOrderAmount(order, order.net_product_sales),
    shippingRevenue: total.shippingRevenue + convertedOrderAmount(order, order.shipping_revenue),
    tax: total.tax + convertedOrderAmount(order, order.tax),
    duties: total.duties + convertedOrderAmount(order, order.duties),
    totalSales: total.totalSales + convertedOrderAmount(order, order.total_sales),
  }), { grossSales: 0, discounts: 0, netProductSales: 0, shippingRevenue: 0, tax: 0, duties: 0, totalSales: 0 });
  const shopifyTotals = shopifyDaily.reduce((total, day) => ({
    grossSales: total.grossSales + monetary(day.gross_sales),
    discounts: total.discounts + Math.abs(monetary(day.discounts)),
    netProductSales: total.netProductSales + monetary(day.net_sales) + Math.abs(monetary(day.sales_reversals)),
    shippingRevenue: total.shippingRevenue + monetary(day.shipping_charges),
    tax: total.tax + monetary(day.taxes),
    duties: total.duties,
    totalSales: total.totalSales + monetary(day.total_sales),
  }), { grossSales: 0, discounts: 0, netProductSales: 0, shippingRevenue: 0, tax: 0, duties: 0, totalSales: 0 });
  const totals = shopifyDaily.length ? shopifyTotals : importedTotals;
  const importedRefunds = refundsRows.reduce((total, refund) => {
    const order = ordersById.get(refund.order_id);
    return total + (order ? convertedOrderAmount(order, refund.total_refunded) : 0);
  }, 0);
  const refunds = shopifyDaily.length
    ? shopifyDaily.reduce((total, day) => total + Math.abs(monetary(day.sales_reversals)), 0)
    : importedRefunds;
  const paymentFeeRules = paymentFeeRuleResult.rows.map((rule): EffectivePaymentFeeRule => ({ gateway: rule.gateway, currency: rule.currency, effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to, percentageRate: monetary(rule.percentage_rate), fixedFee: monetary(rule.fixed_fee), taxRate: monetary(rule.tax_rate), minimumFee: monetary(rule.minimum_fee) }));
  const gatewayPaymentDays: GatewayPaymentDay[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("shopify_payment_gateway_daily")
      .select("payment_date,gateway,gross_payments,transactions,currency")
      .eq("store_id", store.id).order("payment_date", { ascending: true }).order("gateway", { ascending: true });
    if (fromDate) query = query.gte("payment_date", fromDate);
    if (toDate) query = query.lte("payment_date", toDate);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as GatewayPaymentDay[];
    gatewayPaymentDays.push(...page);
    if (page.length < pageSize) break;
  }
  const externalPaymentFees = calculateExternalPaymentFees(gatewayPaymentDays, paymentFeeRules,
    estimateSettingsResult.data as PaymentEstimateSettings | null, store.currency);
  let actualFees = 0;
  const actualFeesByDate: Record<string, number> = {};
  const estimatedFeesByDate: Record<string, number> = {};
  for (const transaction of transactions) {
    if (transaction.status !== "SUCCESS") continue;
    const occurredAt = transaction.processed_at_shopify ?? transaction.created_at_shopify;
    const transactionRate = resolveDatedExchangeRate(exchangeRates, transaction.currency, store.currency, occurredAt);
    if (!transactionRate) continue;
    const feeDate = reportingDateKey(occurredAt, store.timezone || "UTC");
    const actualFee = monetary(transaction.fee_amount) + monetary(transaction.fee_tax);
    if (actualFee > 0) {
      const convertedFee = convertDatedAmount(actualFee, transactionRate, store.currency);
      actualFees += convertedFee;
      actualFeesByDate[feeDate] = (actualFeesByDate[feeDate] ?? 0) + convertedFee;
    }
    else if (!isExternalProcessor(transaction.gateway ?? "")) {
      const rule = selectEffectivePaymentFeeRule(paymentFeeRules, transaction.gateway, store.currency, occurredAt);
      if (rule) {
        const estimate = estimatedTransactionFee(convertDatedAmount(monetary(transaction.amount), transactionRate, store.currency), rule);
        estimatedFeesByDate[feeDate] = (estimatedFeesByDate[feeDate] ?? 0) + estimate;
      }
    }
  }
  const reportedFeesByDate = Object.fromEntries(shopifyDaily.map((day) => [day.sales_date, monetary(day.total_payment_fees)]));
  const salesDays = shopifyDaily.filter((day) => day.orders > 0);
  const reportedFeeDays = salesDays.filter((day) => monetary(day.total_payment_fees) > 0);
  const shopifyPaymentFees = reconcileDailyTransactionFees(reportedFeesByDate, actualFeesByDate, estimatedFeesByDate);
  const transactionFees = shopifyPaymentFees + externalPaymentFees.processorFees + externalPaymentFees.shopifySurcharge;
  const transactionFeesAvailable = transactionFees > 0;
  const transactionFeesComplete = salesDays.length > 0
    ? salesDays.every((day) => monetary(day.total_payment_fees) > 0 || (actualFeesByDate[day.sales_date] ?? 0) > 0)
      || (reportedFeeDays.length === 0 && actualFees > 0 && transactions.length > 0)
    : transactionFeesAvailable;
  const orderDates = includedOrders.flatMap((order) => order.processed_at ? [order.processed_at.slice(0, 10)] : []);
  const reportDates = shopifyDaily.length ? shopifyDaily.map((day) => day.sales_date) : orderDates;
  const rangeStart = reportDates.length ? reportDates.reduce((first, date) => date < first ? date : first) : null;
  const rangeEnd = reportDates.length ? reportDates.reduce((last, date) => date > last ? date : last) : null;

  const metaInsights: MetaInsight[] = [];
  const googleInsights: GoogleInsight[] = [];
  const bingInsights: Array<{ insight_date: string; spend: string; currency: string }> = [];
  if (rangeStart && rangeEnd) {
    const [metaResult, googleResult, bingResult] = await Promise.all([
      supabase.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).gte("date_start", rangeStart).lte("date_start", rangeEnd).order("date_start", { ascending: true }),
      supabase.from("google_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", rangeStart).lte("insight_date", rangeEnd).order("insight_date", { ascending: true }),
      supabase.from("bing_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", rangeStart).lte("insight_date", rangeEnd).order("insight_date", { ascending: true }),
    ]);
    const insightError = metaResult.error ?? googleResult.error ?? bingResult.error;
    if (insightError) return NextResponse.json({ error: insightError.message }, { status: 500 });
    metaInsights.push(...((metaResult.data ?? []) as MetaInsight[]));
    googleInsights.push(...((googleResult.data ?? []) as GoogleInsight[]));
    bingInsights.push(...(bingResult.data ?? []));
  }
  const marketingCurrencyCoverage = createCurrencyConversionCoverage(store.currency);
  const convertedMarketingSpend = (rows: Array<{ date: string; spend: string; currency: string }>) => rows.reduce((total, insight) => {
    const exchangeRate = resolveDatedExchangeRate(exchangeRates, insight.currency, store.currency, insight.date);
    if (!marketingCurrencyCoverage.include(insight.currency, exchangeRate)) return total;
    return total + convertDatedAmount(monetary(insight.spend), exchangeRate ?? 1, store.currency);
  }, 0);
  const metaMarketingSpend = convertedMarketingSpend(metaInsights.map((insight) => ({ date: insight.date_start, spend: insight.spend, currency: insight.currency })));
  const googleMarketingSpend = convertedMarketingSpend(googleInsights.map((insight) => ({ date: insight.insight_date, spend: insight.spend, currency: insight.currency })));
  const bingMarketingSpend = convertedMarketingSpend(bingInsights.map((insight) => ({ date: insight.insight_date, spend: insight.spend, currency: insight.currency })));
  const marketingSpend = metaMarketingSpend + googleMarketingSpend + bingMarketingSpend;
  const marketingCoverage = marketingCurrencyCoverage.summary();
  const marketingSpendAvailable = marketingCoverage.includedRows > 0 && marketingCoverage.excludedRows === 0;

  let fixedOperatingExpenses = 0;
  let variableOperatingExpenses = 0;
  let merchantShippingCosts = variantShippingCosts + defaultPostageCosts;
  let handlingCosts = defaultFulfilmentCosts;
  let shippingCostsAvailable = Boolean(usableStoreCostDefault);
  let handlingCostsAvailable = Boolean(usableStoreCostDefault);
  let unallocatedOperatingCosts = 0;
  for (const cost of operatingCostResult.rows) {
    if (!rangeStart || !rangeEnd || cost.currency !== store.currency) {
      unallocatedOperatingCosts += 1;
      continue;
    }
    const from = laterDate(cost.effective_from, rangeStart);
    const to = earlierDate(cost.effective_to ?? rangeEnd, rangeEnd);
    if (from > to) continue;
    const costBucket = operatingCostBucket(cost.category);
    const isShippingCost = costBucket === "shipping";
    const isHandlingCost = costBucket === "handling";
    if (isHandlingCost) handlingCostsAvailable = true;
    const amount = monetary(cost.amount);
    const variableFrom = cost.cadence === "one_off" ? cost.effective_from : from;
    const variableTo = cost.cadence === "one_off" ? cost.effective_from : to;
    const scopedOrders = includedOrders.filter((order) => order.processed_at && order.processed_at.slice(0, 10) >= variableFrom && order.processed_at.slice(0, 10) <= variableTo);
    const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
    const scopedLines = lines.filter((line) => scopedOrderIds.has(line.order_id));
    const allocatableLines = isShippingCost ? scopedLines.filter((line) => !shippingRuleByLine.has(line)) : scopedLines;
    const allocatableOrderIds = new Set(allocatableLines.map((line) => line.order_id));
    const allocated = allocatePeriodCost({
      amount,
      cadence: cost.cadence,
      basis: cost.allocation_basis,
      activeDays: dayCountInclusive(from, to),
      orderCount: isShippingCost ? allocatableOrderIds.size : scopedOrders.length,
      unitCount: allocatableLines.reduce((total, line) => total + Math.max(line.current_quantity, 0), 0),
      revenue: scopedOrders.filter((order) => !isShippingCost || allocatableOrderIds.has(order.id)).reduce((total, order) => total + convertedOrderAmount(order, order.net_product_sales), 0),
      oneOffInRange: cost.effective_from >= rangeStart && cost.effective_from <= rangeEnd,
    });
    if (isShippingCost) merchantShippingCosts += allocated;
    else if (isHandlingCost) handlingCosts += allocated;
    else if (cost.allocation_basis === "fixed") fixedOperatingExpenses += allocated;
    else variableOperatingExpenses += allocated;
  }
  const defaultShippingCosts = operatingCostResult.rows.filter((cost) => cost.category === "fulfilment" && cost.currency === store.currency);
  const shippingCoverage = summarizeShippingCoverage(lines.map((line): ShippingCoverage => {
    if (shippingRuleByLine.has(line)) return "override";
    const orderDate = ordersById.get(line.order_id)?.processed_at?.slice(0, 10);
    const hasFallback = Boolean(usableStoreCostDefault || (orderDate && defaultShippingCosts.some((cost) => cost.effective_from <= orderDate && (cost.cadence !== "one_off" || cost.effective_from === orderDate) && (!cost.effective_to || cost.effective_to >= orderDate))));
    return hasFallback ? "fallback" : "missing";
  }));
  const shippingFallbackCosts = merchantShippingCosts - variantShippingCosts;
  shippingCostsAvailable = lines.length > 0 ? shippingCoverage.missingLines === 0 : Boolean(usableStoreCostDefault || defaultShippingCosts.length > 0);
  const netProfitAvailable = transactionFeesComplete && marketingSpendAvailable && shippingCostsAvailable && handlingCostsAvailable && missingCostLines === 0 && unallocatedOperatingCosts === 0;
  const calculated = calculateProfitAndLoss({ ...totals, refunds, cogs, marketingSpend, transactionFees, merchantShippingCosts, handlingCosts, fixedOperatingExpenses, variableOperatingExpenses, complete: netProfitAvailable });
  const { data: microsoftConnection } = await supabase.from("data_connections")
    .select("status,last_error").eq("store_id", store.id).eq("provider", "bing_ads").maybeSingle();

  return NextResponse.json({
    hasData: shopifyDaily.length > 0 || includedOrders.length > 0,
    currency: store.currency,
    timezone: store.timezone || "UTC",
    currencyCoverage: currencyCoverage.summary(),
    marketingCurrencyCoverage: marketingCoverage,
    microsoftAdsImportError: microsoftConnection?.last_error ?? null,
    transactionFeeCoverage: { salesDays: salesDays.length, reportedFeeDays: reportedFeeDays.length, latestReportedFeeDate: reportedFeeDays.at(-1)?.sales_date ?? null },
    calculatedAt: new Date().toISOString(),
    metrics: { ...totals, refunds, cogs, ...calculated, marketingSpend, metaMarketingSpend, googleMarketingSpend, bingMarketingSpend, transactionFees, shopifyPaymentFees, estimatedProcessorFees: externalPaymentFees.processorFees, estimatedShopifySurcharge: externalPaymentFees.shopifySurcharge, merchantShippingCosts, variantShippingCosts, shippingFallbackCosts, handlingCosts, fixedOperatingExpenses, variableOperatingExpenses, orders: shopifyDaily.length ? shopifyDaily.reduce((total, day) => total + day.orders, 0) : includedOrders.length, unitsSold: dailyUnitCount || totalOrderUnits, missingCostLines, missingShippingLines: shippingCoverage.missingLines, shippingOverrideLines: shippingCoverage.overrideLines, shippingFallbackLines: shippingCoverage.fallbackLines, shippingFallbackRate: shippingCoverage.fallbackRate, unallocatedOperatingCosts },
    externalPaymentFees: { ...externalPaymentFees, available: gatewayPaymentDays.length > 0 },
    period: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
    availability: { marketingSpend: marketingSpendAvailable, metaMarketingSpend: metaInsights.length > 0, googleMarketingSpend: googleInsights.length > 0, bingMarketingSpend: bingInsights.length > 0 || (microsoftConnection?.status === "connected" && !microsoftConnection.last_error), transactionFees: transactionFeesAvailable, transactionFeesComplete, shippingCosts: shippingCostsAvailable, handlingCosts: handlingCostsAvailable, operatingExpenses: true, netProfit: netProfitAvailable },
  });
}


