import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";

type Order = { id: string; processed_at: string | null; gross_sales: string; discounts: string; net_product_sales: string; shipping_revenue: string; tax: string; duties: string; total_sales: string };
type Line = { order_id: string; variant_gid: string | null; sku: string | null; current_quantity: number };
type Variant = { id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Refund = { total_refunded: string };
type CustomCost = { name: string; amount: string; currency: string; cadence: "one_off" | "daily" | "weekly" | "monthly" | "annual"; allocation_basis: "fixed" | "orders" | "units" | "revenue"; effective_from: string; effective_to: string | null };

const dayMs = 24 * 60 * 60 * 1000;
const utcDay = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
const dayCountInclusive = (from: string, to: string) => Math.floor((utcDay(to) - utcDay(from)) / dayMs) + 1;
const laterDate = (left: string, right: string) => left > right ? left : right;
const earlierDate = (left: string, right: string) => left < right ? left : right;

/**
 * P&L contains reconciled Shopify sales, COGS and fixed operating costs. Ad,
 * transaction, fulfilment and usage-based costs remain separately identified
 * until a trusted source or allocation rule is connected.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: orders, error: ordersError } = await supabase
    .from("shopify_orders")
    .select("id,processed_at,gross_sales,discounts,net_product_sales,shipping_revenue,tax,duties,total_sales")
    .eq("store_id", store.id)
    .is("cancelled_at", null)
    .eq("test", false)
    .not("processed_at", "is", null);
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });
  const includedOrders = (orders ?? []) as Order[];
  const orderIds = includedOrders.map((order) => order.id);

  const [lineResult, variantResult, costResult, refundResult, operatingCostResult] = await Promise.all([
    orderIds.length ? supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,current_quantity").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
    orderIds.length ? supabase.from("shopify_refunds").select("total_refunded").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("custom_costs").select("name,amount,currency,cadence,allocation_basis,effective_from,effective_to").eq("store_id", store.id),
  ]);
  const fetchError = lineResult.error ?? variantResult.error ?? costResult.error ?? refundResult.error ?? operatingCostResult.error;
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

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
  for (const line of (lineResult.data ?? []) as Line[]) {
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
  const refunds = ((refundResult.data ?? []) as Refund[]).reduce((total, refund) => total + monetary(refund.total_refunded), 0);
  const grossProfit = totals.netProductSales - refunds - cogs;
  const orderDates = includedOrders.flatMap((order) => order.processed_at ? [order.processed_at.slice(0, 10)] : []);
  const rangeStart = orderDates.length ? orderDates.reduce((first, date) => date < first ? date : first) : null;
  const rangeEnd = orderDates.length ? orderDates.reduce((last, date) => date > last ? date : last) : null;
  let operatingExpenses = 0;
  let unallocatedOperatingCosts = 0;
  for (const cost of (operatingCostResult.data ?? []) as CustomCost[]) {
    if (!rangeStart || !rangeEnd || cost.currency !== store.currency || cost.allocation_basis !== "fixed") {
      unallocatedOperatingCosts += 1;
      continue;
    }
    const from = laterDate(cost.effective_from, rangeStart);
    const to = earlierDate(cost.effective_to ?? rangeEnd, rangeEnd);
    if (from > to) continue;
    const amount = monetary(cost.amount);
    if (cost.cadence === "one_off") {
      if (cost.effective_from >= rangeStart && cost.effective_from <= rangeEnd) operatingExpenses += amount;
      continue;
    }
    const days = dayCountInclusive(from, to);
    const dailyRate = cost.cadence === "daily" ? amount : cost.cadence === "weekly" ? amount / 7 : cost.cadence === "monthly" ? amount / 30.4375 : amount / 365.25;
    operatingExpenses += dailyRate * days;
  }
  const profitAfterFixedOperatingCosts = grossProfit - operatingExpenses;

  return NextResponse.json({
    hasData: includedOrders.length > 0,
    currency: store.currency,
    calculatedAt: new Date().toISOString(),
    metrics: { ...totals, refunds, cogs, grossProfit, grossMargin: totals.netProductSales - refunds ? grossProfit / (totals.netProductSales - refunds) : null, operatingExpenses, profitAfterFixedOperatingCosts, orders: includedOrders.length, missingCostLines, unallocatedOperatingCosts },
    period: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
    availability: { marketingSpend: false, transactionFees: false, shippingCosts: false, operatingExpenses: true, netProfit: false },
  });
}
