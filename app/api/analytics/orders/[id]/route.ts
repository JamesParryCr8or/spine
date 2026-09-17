import { NextResponse } from "next/server";

import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { createClient } from "@/lib/supabase/server";

type Line = { id: string; variant_gid: string | null; sku: string | null; title: string; variant_title: string | null; current_quantity: number; net_sales: string };
type Variant = { id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: order, error: orderError } = await supabase
    .from("shopify_orders")
    .select("id,order_name,processed_at,financial_status,fulfillment_status,source_name,gross_sales,discounts,net_product_sales,shipping_revenue,tax,duties,total_sales")
    .eq("id", id).eq("store_id", store.id).maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const [lineResult, variantResult, costResult, refundResult] = await Promise.all([
    supabase.from("shopify_order_lines").select("id,variant_gid,sku,title,variant_title,current_quantity,net_sales").eq("order_id", order.id),
    supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
    supabase.from("shopify_refunds").select("total_refunded").eq("order_id", order.id),
  ]);
  const error = lineResult.error ?? variantResult.error ?? costResult.error ?? refundResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const variantsByGid = new Map(((variantResult.data ?? []) as Variant[]).map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(((variantResult.data ?? []) as Variant[]).filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of (costResult.data ?? []) as EffectiveCost[]) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }

  let cogs = 0;
  let missingCostLines = 0;
  const processedDate = order.processed_at?.slice(0, 10) ?? "";
  const lines = ((lineResult.data ?? []) as Line[]).map((line) => {
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const costs = variant ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, processedDate, variant?.shopify_unit_cost === null || variant?.shopify_unit_cost === undefined ? null : monetary(variant.shopify_unit_cost));
    const lineCogs = unitCost === null ? null : unitCost * Math.max(line.current_quantity, 0);
    if (lineCogs === null) missingCostLines += 1;
    else cogs += lineCogs;
    return { ...line, unitCost, cogs: lineCogs };
  });
  const refunds = (refundResult.data ?? []).reduce((total, refund) => total + monetary(refund.total_refunded), 0);
  const netSalesAfterRefunds = monetary(order.net_product_sales) - refunds;
  return NextResponse.json({
    currency: store.currency,
    order,
    lines,
    metrics: { refunds, cogs, grossProfit: netSalesAfterRefunds - cogs, missingCostLines },
  });
}
