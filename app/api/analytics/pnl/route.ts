import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { actualTransactionFees, estimatedTransactionFee, selectEffectivePaymentFeeRule, type EffectivePaymentFeeRule, type ShopifyTransactionFee } from "@/lib/analytics/transaction-fees";
import { allocatePeriodCost, operatingCostBucket } from "@/lib/analytics/cost-allocation";
import { selectEffectiveShippingCost, summarizeShippingCoverage, type ProductShippingCost, type ShippingCoverage } from "@/lib/analytics/shipping-cost";
import { reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { calculateProfitAndLoss } from "@/lib/analytics/profit-and-loss";

type Order = { id: string; processed_at: string | null; gross_sales: string; discounts: string; net_product_sales: string; shipping_revenue: string; tax: string; duties: string; total_sales: string; currency: string };
type Line = { order_id: string; variant_gid: string | null; sku: string | null; current_quantity: number };
type Variant = { id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Refund = { total_refunded: string };
type Transaction = ShopifyTransactionFee & { gateway: string | null; amount: string; processed_at_shopify: string | null; created_at_shopify: string };
type PaymentFeeRuleRow = { gateway: string; percentage_rate: string; fixed_fee: string; tax_rate: string; minimum_fee: string; currency: string; effective_from: string; effective_to: string | null };
type ProductShippingCostRow = ProductShippingCost & { currency: string };
type CustomCost = { name: string; category: string; amount: string; currency: string; cadence: "one_off" | "daily" | "weekly" | "monthly" | "annual"; allocation_basis: "fixed" | "orders" | "units" | "revenue"; effective_from: string; effective_to: string | null };
type MetaInsight = { spend: string };

const dayMs = 24 * 60 * 60 * 1000;
const utcDay = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
const dayCountInclusive = (from: string, to: string) => Math.floor((utcDay(to) - utcDay(from)) / dayMs) + 1;
const laterDate = (left: string, right: string) => left > right ? left : right;
const earlierDate = (left: string, right: string) => left < right ? left : right;
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

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
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency,timezone").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const dateRange = fromDate && toDate ? reportingRangeToUtc(fromDate, toDate, store.timezone || "UTC") : null;

  const includedOrders: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
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
    const { data, error } = await query.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Order[];
    for (const order of page) if (currencyCoverage.include(order.currency)) includedOrders.push(order);
    if (page.length < pageSize) break;
  }
  const orderIds = includedOrders.map((order) => order.id);
  const orderChunks = chunks(orderIds, 500);

  const [lineResults, refundResults, transactionResults, variantResult, costResult, operatingCostResult, paymentFeeRuleResult, productShippingCostResult] = await Promise.all([
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,current_quantity").in("order_id", ids))),
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_refunds").select("total_refunded").in("order_id", ids))),
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_transactions").select("fee_amount,fee_tax,currency,status,gateway,amount,processed_at_shopify,created_at_shopify").in("order_id", ids))),
    supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
    supabase.from("custom_costs").select("name,category,amount,currency,cadence,allocation_basis,effective_from,effective_to").eq("store_id", store.id),
    supabase.from("payment_fee_rules").select("gateway,percentage_rate,fixed_fee,tax_rate,minimum_fee,currency,effective_from,effective_to").eq("store_id", store.id),
    supabase.from("product_shipping_costs").select("id,variant_id,sku,amount,allocation_basis,currency,effective_from,effective_to").eq("store_id", store.id),
  ]);
  const allResults = [...lineResults, ...refundResults, ...transactionResults, variantResult, costResult, operatingCostResult, paymentFeeRuleResult, productShippingCostResult];
  const fetchError = allResults.find((result) => result.error)?.error;
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  const lines = lineResults.flatMap((result) => result.data ?? []) as Line[];
  const refundsRows = refundResults.flatMap((result) => result.data ?? []) as Refund[];
  const transactions = transactionResults.flatMap((result) => result.data ?? []) as Transaction[];

  const variantsByGid = new Map(((variantResult.data ?? []) as Variant[]).map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(((variantResult.data ?? []) as Variant[]).filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of (costResult.data ?? []) as EffectiveCost[]) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }
  const ordersById = new Map(includedOrders.map((order) => [order.id, order]));
  const shippingCostsByKey = new Map<string, ProductShippingCost[]>();
  for (const cost of (productShippingCostResult.data ?? []) as ProductShippingCostRow[]) {
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

  let cogs = 0;
  let missingCostLines = 0;
  for (const line of lines) {
    const order = ordersById.get(line.order_id);
    if (!order?.processed_at) continue;
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const costs = variant ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, order.processed_at.slice(0, 10), variant?.shopify_unit_cost === null || variant?.shopify_unit_cost === undefined ? null : monetary(variant.shopify_unit_cost));
    if (unitCost === null) missingCostLines += 1;
    else cogs += unitCost * Math.max(line.current_quantity, 0);
  }

  const totals = includedOrders.reduce((total, order) => ({
    grossSales: total.grossSales + monetary(order.gross_sales),
    discounts: total.discounts + monetary(order.discounts),
    netProductSales: total.netProductSales + monetary(order.net_product_sales),
    shippingRevenue: total.shippingRevenue + monetary(order.shipping_revenue),
    tax: total.tax + monetary(order.tax),
    duties: total.duties + monetary(order.duties),
    totalSales: total.totalSales + monetary(order.total_sales),
  }), { grossSales: 0, discounts: 0, netProductSales: 0, shippingRevenue: 0, tax: 0, duties: 0, totalSales: 0 });
  const refunds = refundsRows.reduce((total, refund) => total + monetary(refund.total_refunded), 0);
  const paymentFeeRules = ((paymentFeeRuleResult.data ?? []) as PaymentFeeRuleRow[]).map((rule): EffectivePaymentFeeRule => ({ gateway: rule.gateway, currency: rule.currency, effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to, percentageRate: monetary(rule.percentage_rate), fixedFee: monetary(rule.fixed_fee), taxRate: monetary(rule.tax_rate), minimumFee: monetary(rule.minimum_fee) }));
  const actualFees = actualTransactionFees(transactions, store.currency);
  const estimatedFees = transactions.filter((transaction) => transaction.status === "SUCCESS" && transaction.currency === store.currency && monetary(transaction.fee_amount) + monetary(transaction.fee_tax) === 0).reduce((total, transaction) => {
    const rule = selectEffectivePaymentFeeRule(paymentFeeRules, transaction.gateway, transaction.currency, transaction.processed_at_shopify ?? transaction.created_at_shopify);
    return total + (rule ? estimatedTransactionFee(monetary(transaction.amount), rule) : 0);
  }, 0);
  const transactionFees = actualFees + estimatedFees;
  const transactionFeesAvailable = actualFees > 0 || estimatedFees > 0;
  const orderDates = includedOrders.flatMap((order) => order.processed_at ? [order.processed_at.slice(0, 10)] : []);
  const rangeStart = orderDates.length ? orderDates.reduce((first, date) => date < first ? date : first) : null;
  const rangeEnd = orderDates.length ? orderDates.reduce((last, date) => date > last ? date : last) : null;
  const metaInsights: MetaInsight[] = [];
  if (rangeStart && rangeEnd) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("meta_ad_insights_daily")
        .select("spend")
        .eq("store_id", store.id)
        .eq("currency", store.currency)
        .gte("date_start", rangeStart)
        .lte("date_start", rangeEnd)
        .order("date_start", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const page = (data ?? []) as MetaInsight[];
      metaInsights.push(...page);
      if (page.length < pageSize) break;
    }
  }
  const marketingSpend = metaInsights.reduce((total, insight) => total + monetary(insight.spend), 0);
  const marketingSpendAvailable = metaInsights.length > 0;

  let fixedOperatingExpenses = 0;
  let variableOperatingExpenses = 0;
  let merchantShippingCosts = variantShippingCosts;
  let handlingCosts = 0;
  let shippingCostsAvailable = false;
  let handlingCostsAvailable = false;
  let unallocatedOperatingCosts = 0;
  for (const cost of (operatingCostResult.data ?? []) as CustomCost[]) {
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
      revenue: scopedOrders.filter((order) => !isShippingCost || allocatableOrderIds.has(order.id)).reduce((total, order) => total + monetary(order.net_product_sales), 0),
      oneOffInRange: cost.effective_from >= rangeStart && cost.effective_from <= rangeEnd,
    });
    if (isShippingCost) merchantShippingCosts += allocated;
    else if (isHandlingCost) handlingCosts += allocated;
    else if (cost.allocation_basis === "fixed") fixedOperatingExpenses += allocated;
    else variableOperatingExpenses += allocated;
  }
  const defaultShippingCosts = ((operatingCostResult.data ?? []) as CustomCost[]).filter((cost) => cost.category === "fulfilment" && cost.currency === store.currency);
  const shippingCoverage = summarizeShippingCoverage(lines.map((line): ShippingCoverage => {
    if (shippingRuleByLine.has(line)) return "override";
    const orderDate = ordersById.get(line.order_id)?.processed_at?.slice(0, 10);
    const hasFallback = Boolean(orderDate && defaultShippingCosts.some((cost) => cost.effective_from <= orderDate && (cost.cadence !== "one_off" || cost.effective_from === orderDate) && (!cost.effective_to || cost.effective_to >= orderDate)));
    return hasFallback ? "fallback" : "missing";
  }));
  const shippingFallbackCosts = merchantShippingCosts - variantShippingCosts;
  shippingCostsAvailable = lines.length > 0 ? shippingCoverage.missingLines === 0 : defaultShippingCosts.length > 0;
  const netProfitAvailable = marketingSpendAvailable && shippingCostsAvailable && handlingCostsAvailable && missingCostLines === 0 && unallocatedOperatingCosts === 0;
  const calculated = calculateProfitAndLoss({ ...totals, refunds, cogs, marketingSpend, transactionFees, merchantShippingCosts, handlingCosts, fixedOperatingExpenses, variableOperatingExpenses, complete: netProfitAvailable });

  return NextResponse.json({
    hasData: includedOrders.length > 0,
    currency: store.currency,
    currencyCoverage: currencyCoverage.summary(),
    calculatedAt: new Date().toISOString(),
    metrics: { ...totals, refunds, cogs, ...calculated, marketingSpend, transactionFees, merchantShippingCosts, variantShippingCosts, shippingFallbackCosts, handlingCosts, fixedOperatingExpenses, variableOperatingExpenses, orders: includedOrders.length, missingCostLines, missingShippingLines: shippingCoverage.missingLines, shippingOverrideLines: shippingCoverage.overrideLines, shippingFallbackLines: shippingCoverage.fallbackLines, shippingFallbackRate: shippingCoverage.fallbackRate, unallocatedOperatingCosts },
    period: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
    availability: { marketingSpend: marketingSpendAvailable, transactionFees: transactionFeesAvailable, shippingCosts: shippingCostsAvailable, handlingCosts: handlingCostsAvailable, operatingExpenses: true, netProfit: netProfitAvailable },
  });
}
