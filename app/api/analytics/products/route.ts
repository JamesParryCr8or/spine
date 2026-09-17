import { NextResponse } from "next/server";

import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { createClient } from "@/lib/supabase/server";

type Order = { id: string; processed_at: string | null };
type Line = { order_id: string; variant_gid: string | null; sku: string | null; title: string; variant_title: string | null; current_quantity: number; net_sales: string };
type Variant = { id: string; product_id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null };
type Product = { id: string; title: string };

type ProductProfit = { key: string; product: string; variant: string; sku: string | null; units: number; revenue: number; cogs: number; missingCostUnits: number };

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
    .select("id,processed_at")
    .eq("store_id", store.id)
    .is("cancelled_at", null)
    .eq("test", false)
    .not("processed_at", "is", null);
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });
  const orderRows = (orders ?? []) as Order[];
  const orderIds = orderRows.map((order) => order.id);
  const [lineResult, variantResult, productResult, costResult] = await Promise.all([
    orderIds.length ? supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,title,variant_title,current_quantity,net_sales").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("shopify_variants").select("id,product_id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("shopify_products").select("id,title").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
  ]);
  const fetchError = lineResult.error ?? variantResult.error ?? productResult.error ?? costResult.error;
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const orderById = new Map(orderRows.map((order) => [order.id, order]));
  const variants = (variantResult.data ?? []) as Variant[];
  const variantsByGid = new Map(variants.map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(variants.filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const productNames = new Map(((productResult.data ?? []) as Product[]).map((product) => [product.id, product.title]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of (costResult.data ?? []) as EffectiveCost[]) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }

  const profits = new Map<string, ProductProfit>();
  for (const line of (lineResult.data ?? []) as Line[]) {
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
      cogs: 0,
      missingCostUnits: 0,
    };
    const quantity = Math.max(line.current_quantity, 0);
    const costs = variant ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? [] : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, order.processed_at.slice(0, 10), variant?.shopify_unit_cost === null || variant?.shopify_unit_cost === undefined ? null : monetary(variant.shopify_unit_cost));
    current.units += quantity;
    current.revenue += monetary(line.net_sales);
    if (unitCost === null) current.missingCostUnits += quantity;
    else current.cogs += unitCost * quantity;
    profits.set(key, current);
  }

  const products = [...profits.values()]
    .map((product) => ({ ...product, grossProfit: product.revenue - product.cogs, margin: product.missingCostUnits ? null : product.revenue ? (product.revenue - product.cogs) / product.revenue : null }))
    .sort((left, right) => right.revenue - left.revenue);
  return NextResponse.json({ hasData: products.length > 0, currency: store.currency, products });
}
