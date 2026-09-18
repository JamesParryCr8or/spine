import { NextResponse } from "next/server";

import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { allocatePeriodCost, operatingCostBucket } from "@/lib/analytics/cost-allocation";
import { selectEffectiveShippingCost, type ProductShippingCost } from "@/lib/analytics/shipping-cost";
import { proportionalAllocations } from "@/lib/analytics/proportional-allocation";
import { estimatedTransactionFee, selectEffectivePaymentFeeRule, type EffectivePaymentFeeRule, type ShopifyTransactionFee } from "@/lib/analytics/transaction-fees";
import { allocateOrderRefund } from "@/lib/analytics/refund-allocation";
import { calculateProductProfit } from "@/lib/analytics/product-profit";
import { createClient } from "@/lib/supabase/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";

type Order = { id: string; processed_at: string | null; currency: string; exchange_rate: number };
type Line = { order_id: string; shopify_gid: string; variant_gid: string | null; sku: string | null; title: string; variant_title: string | null; current_quantity: number; net_sales: string; discounts: string };
type RefundLine = { line_item_gid: string; subtotal: string };
type Refund = { order_id: string; total_refunded: string };
type Variant = { id: string; product_id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Product = { id: string; title: string };
type CustomCost = { category: string; amount: string; currency: string; cadence: "one_off" | "daily" | "weekly" | "monthly" | "annual"; allocation_basis: "fixed" | "orders" | "units" | "revenue"; effective_from: string; effective_to: string | null };
type ShippingCostRow = ProductShippingCost & { currency: string };
type MetaInsight = { spend: string };
type Transaction = ShopifyTransactionFee & { order_id: string; gateway: string | null; amount: string; processed_at_shopify: string | null; created_at_shopify: string };
type PaymentFeeRuleRow = { gateway: string; percentage_rate: string; fixed_fee: string; tax_rate: string; minimum_fee: string; currency: string; effective_from: string; effective_to: string | null };

type ProductProfit = { key: string; product: string; variant: string; sku: string | null; units: number; revenue: number; discounts: number; refunds: number; cogs: number; missingCostUnits: number; shippingCosts: number; handlingCosts: number; trend: Map<string, { period: string; units: number; revenue: number; refunds: number }> };
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
const dayMs = 24 * 60 * 60 * 1000;
const dayCountInclusive = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs) + 1;
const laterDate = (left: string, right: string) => left > right ? left : right;
const earlierDate = (left: string, right: string) => left < right ? left : right;

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
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: exchangeRateRows, error: exchangeRateError } = await supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true });
  if (exchangeRateError) return NextResponse.json({ error: exchangeRateError.message }, { status: 500 });
  const exchangeRates = (exchangeRateRows ?? []) as DatedExchangeRate[];
  const orderRows: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("shopify_orders")
      .select("id,processed_at,currency")
      .eq("store_id", store.id)
      .is("cancelled_at", null)
      .eq("test", false)
      .not("processed_at", "is", null);
    if (fromDate) query = query.gte("processed_at", `${fromDate}T00:00:00.000Z`);
    if (toDate) query = query.lte("processed_at", `${toDate}T23:59:59.999Z`);
    const { data, error } = await query.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Array<Omit<Order, "exchange_rate">>;
    for (const order of page) {
      const exchangeRate = resolveDatedExchangeRate(exchangeRates, order.currency, store.currency, order.processed_at ?? "");
      if (currencyCoverage.include(order.currency, exchangeRate)) orderRows.push({ ...order, exchange_rate: exchangeRate ?? 1 });
    }
    if (page.length < pageSize) break;
  }
  const orderIds = orderRows.map((order) => order.id);
  const orderChunks = chunks(orderIds, 500);

  const [lineResults, refundResults, transactionResults, variantResult, productResult, costResult, shippingCostResult, customCostResult, paymentFeeRuleResult] = await Promise.all([
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_order_lines").select("order_id,shopify_gid,variant_gid,sku,title,variant_title,current_quantity,net_sales,discounts").in("order_id", ids))),
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_refunds").select("order_id,total_refunded").in("order_id", ids))),
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_transactions").select("order_id,fee_amount,fee_tax,currency,status,gateway,amount,processed_at_shopify,created_at_shopify").in("order_id", ids))),
    supabase.from("shopify_variants").select("id,product_id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("shopify_products").select("id,title").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
    supabase.from("product_shipping_costs").select("id,variant_id,sku,amount,allocation_basis,currency,effective_from,effective_to").eq("store_id", store.id),
    supabase.from("custom_costs").select("category,amount,currency,cadence,allocation_basis,effective_from,effective_to").eq("store_id", store.id),
    supabase.from("payment_fee_rules").select("gateway,percentage_rate,fixed_fee,tax_rate,minimum_fee,currency,effective_from,effective_to").eq("store_id", store.id),
  ]);
  const fetchError = [...lineResults, ...refundResults, ...transactionResults, variantResult, productResult, costResult, shippingCostResult, customCostResult, paymentFeeRuleResult].find((result) => result.error)?.error;
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  const lines = lineResults.flatMap((result) => result.data ?? []) as Line[];
  const transactions = transactionResults.flatMap((result) => result.data ?? []) as Transaction[];
  const refunds = refundResults.flatMap((result) => result.data ?? []) as Refund[];

  const refundRows: RefundLine[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("shopify_refund_lines").select("line_item_gid,subtotal").eq("store_id", store.id).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as RefundLine[];
    refundRows.push(...page);
    if (page.length < pageSize) break;
  }
  const orderById = new Map(orderRows.map((order) => [order.id, order]));
  const lineByGid = new Map(lines.map((line) => [line.shopify_gid, line]));
  const explicitRefundsByLine = new Map<string, number>();
  for (const refund of refundRows) {
    const line = lineByGid.get(refund.line_item_gid);
    const order = line ? orderById.get(line.order_id) : null;
    if (!order) continue;
    const amount = convertDatedAmount(monetary(refund.subtotal), order.exchange_rate, store.currency);
    explicitRefundsByLine.set(refund.line_item_gid, (explicitRefundsByLine.get(refund.line_item_gid) ?? 0) + amount);
  }
  const totalRefundsByOrder = new Map<string, number>();
  for (const refund of refunds) {
    const order = orderById.get(refund.order_id);
    if (!order) continue;
    const amount = convertDatedAmount(monetary(refund.total_refunded), order.exchange_rate, store.currency);
    totalRefundsByOrder.set(refund.order_id, (totalRefundsByOrder.get(refund.order_id) ?? 0) + amount);
  }
  const refundsByLine = new Map<string, number>();
  for (const order of orderRows) {
    const orderLines = lines.filter((line) => line.order_id === order.id);
    const allocations = allocateOrderRefund(totalRefundsByOrder.get(order.id) ?? 0, orderLines.map((line) => ({ key: line.shopify_gid, netSales: convertDatedAmount(monetary(line.net_sales), order.exchange_rate, store.currency), explicitRefund: explicitRefundsByLine.get(line.shopify_gid) ?? 0 })));
    for (const [lineId, amount] of allocations) refundsByLine.set(lineId, amount);
  }

  const variants = (variantResult.data ?? []) as Variant[];
  const variantsByGid = new Map(variants.map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(variants.filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const productNames = new Map(((productResult.data ?? []) as Product[]).map((product) => [product.id, product.title]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of (costResult.data ?? []) as EffectiveCost[]) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }
  const shippingCostsByKey = new Map<string, ProductShippingCost[]>();
  for (const cost of (shippingCostResult.data ?? []) as ShippingCostRow[]) {
    if (cost.currency !== store.currency) continue;
    const key = costKey(cost);
    if (key) shippingCostsByKey.set(key, [...(shippingCostsByKey.get(key) ?? []), cost]);
  }

  const profits = new Map<string, ProductProfit>();
  const profitKeyByLine = new Map<Line, string>();
  const shippingOverrideLines = new Set<Line>();
  const chargedOrderShippingRules = new Set<string>();
  for (const line of lines) {
    const order = orderById.get(line.order_id);
    if (!order?.processed_at) continue;
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const key = variant?.id ?? line.variant_gid ?? `sku:${line.sku?.trim().toLowerCase() ?? line.title}`;
    const current = profits.get(key) ?? {
      key,
      product: variant ? productNames.get(variant.product_id) ?? line.title : line.title,
      variant: line.variant_title ?? "Default variant",
      sku: variant?.sku ?? line.sku,
      units: 0,
      revenue: 0,
      discounts: 0,
      refunds: 0,
      cogs: 0,
      missingCostUnits: 0,
      shippingCosts: 0,
      handlingCosts: 0,
      trend: new Map(),
    };
    const quantity = Math.max(line.current_quantity, 0);
    const costs = variant ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, order.processed_at.slice(0, 10), variant?.shopify_unit_cost === null || variant?.shopify_unit_cost === undefined ? null : monetary(variant.shopify_unit_cost));
    current.units += quantity;
    current.revenue += convertDatedAmount(monetary(line.net_sales), order.exchange_rate, store.currency);
    current.discounts += convertDatedAmount(monetary(line.discounts), order.exchange_rate, store.currency);
    current.refunds += refundsByLine.get(line.shopify_gid) ?? 0;
    const trendPeriod = order.processed_at.slice(0, 7);
    const trend = current.trend.get(trendPeriod) ?? { period: trendPeriod, units: 0, revenue: 0, refunds: 0 };
    trend.units += quantity;
    trend.revenue += convertDatedAmount(monetary(line.net_sales), order.exchange_rate, store.currency);
    trend.refunds += refundsByLine.get(line.shopify_gid) ?? 0;
    current.trend.set(trendPeriod, trend);
    if (unitCost === null) current.missingCostUnits += quantity;
    else current.cogs += unitCost * quantity;
    const shippingRules = variant ? shippingCostsByKey.get(`variant:${variant.id}`) ?? shippingCostsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : shippingCostsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const shippingRule = selectEffectiveShippingCost(shippingRules, order.processed_at.slice(0, 10));
    if (shippingRule) {
      shippingOverrideLines.add(line);
      if (shippingRule.allocation_basis === "units") current.shippingCosts += monetary(shippingRule.amount) * quantity;
      else {
        const chargeKey = `${line.order_id}:${shippingRule.id}`;
        if (!chargedOrderShippingRules.has(chargeKey)) { current.shippingCosts += monetary(shippingRule.amount); chargedOrderShippingRules.add(chargeKey); }
      }
    }
    profitKeyByLine.set(line, key);
    profits.set(key, current);
  }

  const rangeStart = orderRows[0]?.processed_at?.slice(0, 10) ?? null;
  const rangeEnd = orderRows.at(-1)?.processed_at?.slice(0, 10) ?? null;
  const allocateAcrossProducts = (amount: number, eligibleLines: Line[], field: "shippingCosts" | "handlingCosts") => {
    if (amount <= 0 || !eligibleLines.length) return;
    const revenueWeights = new Map<string, number>();
    const unitWeights = new Map<string, number>();
    for (const line of eligibleLines) {
      const key = profitKeyByLine.get(line);
      if (!key) continue;
      const order = orderById.get(line.order_id);
      const revenue = order ? convertDatedAmount(monetary(line.net_sales), order.exchange_rate, store.currency) : 0;
      revenueWeights.set(key, (revenueWeights.get(key) ?? 0) + Math.max(revenue - (refundsByLine.get(line.shopify_gid) ?? 0), 0));
      unitWeights.set(key, (unitWeights.get(key) ?? 0) + Math.max(line.current_quantity, 0));
    }
    const revenueTotal = [...revenueWeights.values()].reduce((total, value) => total + value, 0);
    const allocations = proportionalAllocations(amount, revenueTotal > 0 ? revenueWeights : unitWeights);
    for (const [key, product] of profits) {
      product[field] += allocations.get(key) ?? 0;
    }
  };

  if (rangeStart && rangeEnd) {
    for (const cost of (customCostResult.data ?? []) as CustomCost[]) {
      const bucket = operatingCostBucket(cost.category);
      if (bucket === "operating" || cost.currency !== store.currency) continue;
      const from = laterDate(cost.effective_from, rangeStart);
      const to = earlierDate(cost.effective_to ?? rangeEnd, rangeEnd);
      if (from > to) continue;
      const scopeFrom = cost.cadence === "one_off" ? cost.effective_from : from;
      const scopeTo = cost.cadence === "one_off" ? cost.effective_from : to;
      const scopedOrders = orderRows.filter((order) => order.processed_at && order.processed_at.slice(0, 10) >= scopeFrom && order.processed_at.slice(0, 10) <= scopeTo);
      const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
      const scopedLines = lines.filter((line) => scopedOrderIds.has(line.order_id));
      const eligibleLines = bucket === "shipping" ? scopedLines.filter((line) => !shippingOverrideLines.has(line)) : scopedLines;
      const eligibleOrderIds = new Set(eligibleLines.map((line) => line.order_id));
      const allocated = allocatePeriodCost({
        amount: monetary(cost.amount),
        cadence: cost.cadence,
        basis: cost.allocation_basis,
        activeDays: dayCountInclusive(from, to),
        orderCount: eligibleOrderIds.size,
        unitCount: eligibleLines.reduce((total, line) => total + Math.max(line.current_quantity, 0), 0),
        revenue: eligibleLines.reduce((total, line) => {
          const order = orderById.get(line.order_id);
          return total + (order ? convertDatedAmount(monetary(line.net_sales), order.exchange_rate, store.currency) : 0);
        }, 0),
        oneOffInRange: cost.effective_from >= rangeStart && cost.effective_from <= rangeEnd,
      });
      allocateAcrossProducts(allocated, cost.allocation_basis === "fixed" ? scopedLines : eligibleLines, bucket === "shipping" ? "shippingCosts" : "handlingCosts");
    }
  }

  const metaInsights: MetaInsight[] = [];
  if (rangeStart && rangeEnd) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("meta_ad_insights_daily").select("spend").eq("store_id", store.id).eq("currency", store.currency).gte("date_start", rangeStart).lte("date_start", rangeEnd).range(from, from + pageSize - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const page = (data ?? []) as MetaInsight[];
      metaInsights.push(...page);
      if (page.length < pageSize) break;
    }
  }
  const marketingSpend = metaInsights.reduce((total, insight) => total + monetary(insight.spend), 0);
  const revenueWeights = new Map([...profits].map(([key, product]) => [key, Math.max(product.revenue - product.refunds, 0)]));
  const marketingAllocations = proportionalAllocations(marketingSpend, revenueWeights);
  const paymentFeeRules = ((paymentFeeRuleResult.data ?? []) as PaymentFeeRuleRow[]).map((rule): EffectivePaymentFeeRule => ({ gateway: rule.gateway, currency: rule.currency, effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to, percentageRate: monetary(rule.percentage_rate), fixedFee: monetary(rule.fixed_fee), taxRate: monetary(rule.tax_rate), minimumFee: monetary(rule.minimum_fee) }));
  const transactionFees = transactions.filter((transaction) => transaction.status === "SUCCESS").reduce((total, transaction) => {
    const order = orderById.get(transaction.order_id);
    if (!order) return total;
    const occurredAt = transaction.processed_at_shopify ?? transaction.created_at_shopify;
    const transactionRate = resolveDatedExchangeRate(exchangeRates, transaction.currency, store.currency, occurredAt);
    if (!transactionRate) return total;
    const actualFee = monetary(transaction.fee_amount) + monetary(transaction.fee_tax);
    if (actualFee > 0) return total + convertDatedAmount(actualFee, transactionRate, store.currency);
    const rule = selectEffectivePaymentFeeRule(paymentFeeRules, transaction.gateway, store.currency, occurredAt);
    const convertedAmount = convertDatedAmount(monetary(transaction.amount), transactionRate, store.currency);
    return total + (rule ? estimatedTransactionFee(convertedAmount, rule) : 0);
  }, 0);
  const transactionFeeAllocations = proportionalAllocations(transactionFees, revenueWeights);

  const products = [...profits.values()]
    .map((product) => {
      const marketingAllocation = marketingAllocations.get(product.key) ?? 0;
      const transactionFeeAllocation = transactionFeeAllocations.get(product.key) ?? 0;
      const calculated = calculateProductProfit({ grossSales: product.revenue + product.discounts, discounts: product.discounts, refunds: product.refunds, cogs: product.cogs, shippingCosts: product.shippingCosts, handlingCosts: product.handlingCosts, transactionFees: transactionFeeAllocation, marketingAllocation, costCoverageComplete: product.missingCostUnits === 0 });
      return { ...product, trend: [...product.trend.values()].sort((left, right) => left.period.localeCompare(right.period)).map((period) => ({ ...period, netRevenue: period.revenue - period.refunds })), netRevenue: calculated.netRevenue, grossProfit: calculated.grossProfit, margin: calculated.grossMargin, transactionFeeAllocation, marketingAllocation, contributionProfit: calculated.contributionProfit, contributionMargin: calculated.contributionMargin };
    })
    .sort((left, right) => right.netRevenue - left.netRevenue);
  return NextResponse.json({
    hasData: products.length > 0,
    currency: store.currency,
    currencyCoverage: currencyCoverage.summary(),
    period: orderRows.length ? { start: orderRows[0].processed_at?.slice(0, 10), end: orderRows.at(-1)?.processed_at?.slice(0, 10) } : null,
    products,
  });
}
