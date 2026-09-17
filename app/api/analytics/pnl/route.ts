import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type Order = { id: string; processed_at: string | null; gross_sales: string; discounts: string; net_product_sales: string; shipping_revenue: string; tax: string; duties: string; total_sales: string };
type Line = { order_id: string; variant_gid: string | null; sku: string | null; current_quantity: number };
type Variant = { id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Cost = { variant_id: string | null; sku: string | null; amount: string; effective_from: string; effective_to: string | null; source: string };
type Refund = { total_refunded: string };

const sourcePriority: Record<string, number> = { manual: 4, csv: 3, google_sheets: 2, shopify: 1 };

function monetary(value: string | number | null | undefined) {
  return Number(value) || 0;
}

function resolveCost(costs: Cost[], orderDate: string, fallback: number | null) {
  const applicable = costs
    .filter((cost) => cost.effective_from <= orderDate && (!cost.effective_to || cost.effective_to >= orderDate))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from) || (sourcePriority[right.source] ?? 0) - (sourcePriority[left.source] ?? 0));
  return applicable.length ? monetary(applicable[0].amount) : fallback;
}

/**
 * P&L v1 intentionally contains only reconciled Shopify sales and COGS. Ad,
 * transaction, fulfilment and operating costs are shown as unavailable until a
 * trusted source is connected, rather than being guessed in the browser.
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

  const [lineResult, variantResult, costResult, refundResult] = await Promise.all([
    orderIds.length ? supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,current_quantity").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
    orderIds.length ? supabase.from("shopify_refunds").select("total_refunded").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const fetchError = lineResult.error ?? variantResult.error ?? costResult.error ?? refundResult.error;
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const variantsByGid = new Map(((variantResult.data ?? []) as Variant[]).map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(((variantResult.data ?? []) as Variant[]).filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const costsByKey = new Map<string, Cost[]>();
  for (const cost of (costResult.data ?? []) as Cost[]) {
    const key = cost.variant_id ? `variant:${cost.variant_id}` : cost.sku ? `sku:${cost.sku.trim().toLowerCase()}` : null;
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
    const unitCost = resolveCost(costs, order.processed_at.slice(0, 10), variant?.shopify_unit_cost === null || variant?.shopify_unit_cost === undefined ? null : monetary(variant.shopify_unit_cost));
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

  return NextResponse.json({
    hasData: includedOrders.length > 0,
    currency: store.currency,
    calculatedAt: new Date().toISOString(),
    metrics: { ...totals, refunds, cogs, grossProfit, grossMargin: totals.netProductSales - refunds ? grossProfit / (totals.netProductSales - refunds) : null, orders: includedOrders.length, missingCostLines },
    availability: { marketingSpend: false, transactionFees: false, shippingCosts: false, operatingExpenses: false, netProfit: false },
  });
}
