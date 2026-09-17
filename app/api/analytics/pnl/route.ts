import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";

type Order = { id: string; processed_at: string | null; gross_sales: string; discounts: string; net_product_sales: string; shipping_revenue: string; tax: string; duties: string; total_sales: string };
type Line = { order_id: string; variant_gid: string | null; sku: string | null; current_quantity: number };
type Variant = { id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Refund = { total_refunded: string };
type Transaction = { fee_amount: string; fee_tax: string; currency: string; status: string };
type CustomCost = { name: string; amount: string; currency: string; cadence: "one_off" | "daily" | "weekly" | "monthly" | "annual"; allocation_basis: "fixed" | "orders" | "units" | "revenue"; effective_from: string; effective_to: string | null };
type MetaInsight = { spend: string };

const dayMs = 24 * 60 * 60 * 1000;
const utcDay = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
const dayCountInclusive = (from: string, to: string) => Math.floor((utcDay(to) - utcDay(from)) / dayMs) + 1;
const laterDate = (left: string, right: string) => left > right ? left : right;
const earlierDate = (left: string, right: string) => left < right ? left : right;
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/**
 * P&L contains every imported valid Shopify order. Fees are only included
 * when Shopify supplied actual transaction-fee records; unconnected cost
 * sources remain visible as unavailable rather than being estimated.
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
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const includedOrders: Order[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("shopify_orders")
      .select("id,processed_at,gross_sales,discounts,net_product_sales,shipping_revenue,tax,duties,total_sales")
      .eq("store_id", store.id)
      .is("cancelled_at", null)
      .eq("test", false)
      .not("processed_at", "is", null);
    if (fromDate) query = query.gte("processed_at", `${fromDate}T00:00:00.000Z`);
    if (toDate) query = query.lte("processed_at", `${toDate}T23:59:59.999Z`);
    const { data, error } = await query.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Order[];
    includedOrders.push(...page);
    if (page.length < pageSize) break;
  }
  const orderIds = includedOrders.map((order) => order.id);
  const orderChunks = chunks(orderIds, 500);

  const [lineResults, refundResults, transactionResults, variantResult, costResult, operatingCostResult] = await Promise.all([
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,current_quantity").in("order_id", ids))),
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_refunds").select("total_refunded").in("order_id", ids))),
    Promise.all(orderChunks.map((ids) => supabase.from("shopify_transactions").select("fee_amount,fee_tax,currency,status").in("order_id", ids))),
    supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
    supabase.from("custom_costs").select("name,amount,currency,cadence,allocation_basis,effective_from,effective_to").eq("store_id", store.id),
  ]);
  const allResults = [...lineResults, ...refundResults, ...transactionResults, variantResult, costResult, operatingCostResult];
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
  const transactionFees = transactions
    .filter((transaction) => transaction.status === "SUCCESS" && transaction.currency === store.currency)
    .reduce((total, transaction) => total + monetary(transaction.fee_amount) + monetary(transaction.fee_tax), 0);
  const transactionFeesAvailable = transactions.length > 0;
  const grossProfit = totals.netProductSales - refunds - cogs;
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
  let unallocatedOperatingCosts = 0;
  for (const cost of (operatingCostResult.data ?? []) as CustomCost[]) {
    if (!rangeStart || !rangeEnd || cost.currency !== store.currency) {
      unallocatedOperatingCosts += 1;
      continue;
    }
    const from = laterDate(cost.effective_from, rangeStart);
    const to = earlierDate(cost.effective_to ?? rangeEnd, rangeEnd);
    if (from > to) continue;
    const amount = monetary(cost.amount);
    if (cost.allocation_basis === "fixed") {
      if (cost.cadence === "one_off") {
        if (cost.effective_from >= rangeStart && cost.effective_from <= rangeEnd) fixedOperatingExpenses += amount;
        continue;
      }
      const days = dayCountInclusive(from, to);
      const dailyRate = cost.cadence === "daily" ? amount : cost.cadence === "weekly" ? amount / 7 : cost.cadence === "monthly" ? amount / 30.4375 : amount / 365.25;
      fixedOperatingExpenses += dailyRate * days;
      continue;
    }
    const variableFrom = cost.cadence === "one_off" ? cost.effective_from : from;
    const variableTo = cost.cadence === "one_off" ? cost.effective_from : to;
    const scopedOrders = includedOrders.filter((order) => order.processed_at && order.processed_at.slice(0, 10) >= variableFrom && order.processed_at.slice(0, 10) <= variableTo);
    if (cost.allocation_basis === "orders") {
      variableOperatingExpenses += amount * scopedOrders.length;
    } else if (cost.allocation_basis === "units") {
      const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
      variableOperatingExpenses += amount * lines.filter((line) => scopedOrderIds.has(line.order_id)).reduce((total, line) => total + Math.max(line.current_quantity, 0), 0);
    } else {
      variableOperatingExpenses += amount / 100 * scopedOrders.reduce((total, order) => total + monetary(order.net_product_sales), 0);
    }
  }
  const operatingExpenses = fixedOperatingExpenses + variableOperatingExpenses;
  const profitAfterOperatingCosts = grossProfit - operatingExpenses;
  const profitAfterKnownCosts = profitAfterOperatingCosts - transactionFees;
  const profitAfterMarketingSpend = profitAfterKnownCosts - marketingSpend;

  return NextResponse.json({
    hasData: includedOrders.length > 0,
    currency: store.currency,
    calculatedAt: new Date().toISOString(),
    metrics: { ...totals, refunds, cogs, grossProfit, grossMargin: totals.netProductSales - refunds ? grossProfit / (totals.netProductSales - refunds) : null, marketingSpend, transactionFees, fixedOperatingExpenses, variableOperatingExpenses, operatingExpenses, profitAfterOperatingCosts, profitAfterKnownCosts, profitAfterMarketingSpend, orders: includedOrders.length, missingCostLines, unallocatedOperatingCosts },
    period: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
    availability: { marketingSpend: marketingSpendAvailable, transactionFees: transactionFeesAvailable, shippingCosts: false, operatingExpenses: true, netProfit: false },
  });
}