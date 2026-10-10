import { NextResponse } from "next/server";

import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { computeSalesInsights, storeDomainFromUrl, type InsightLine, type InsightOrder } from "@/lib/analytics/sales-insights";
import { selectAllPages } from "@/lib/supabase/select-all";
import { selectOrdersByProcessedAt } from "@/lib/supabase/select-orders";
import { requireWorkspace } from "@/lib/workspace/server";

type OrderRow = { id: string; customer_id: string | null; processed_at: string; source_name: string | null; country_code: string | null; discount_codes: string[] | null; net_product_sales: string | number; discounts: string | number };
type LineRow = { order_id: string; product_gid: string | null; title: string; variant_gid: string | null; sku: string | null; current_quantity: number; net_sales: string | number };

const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

function mergeChunkPages<T>(chunkPages: Array<{ data: T[] | null; error: { message: string } | null }>) {
  const error = chunkPages.find((page) => page.error)?.error ?? null;
  if (error) return { data: null, error };
  return { data: chunkPages.flatMap((page) => page.data ?? []), error: null };
}

export async function GET(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if ((from && !to) || (!from && to)) return NextResponse.json({ error: "Choose both a start and end date" }, { status: 400 });
  let utcRange: { start: string; endExclusive: string } | null = null;
  if (from && to) {
    try {
      utcRange = reportingRangeToUtc(from, to, store.timezone || "UTC");
      if (utcRange.start >= utcRange.endExclusive) return NextResponse.json({ error: "Start date must be on or before end date" }, { status: 400 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid date range" }, { status: 400 });
    }
  }

  const { rows: orderRows, error: ordersError } = await selectOrdersByProcessedAt<OrderRow>((cursor, limit) => {
    let query = supabase
      .from("shopify_orders")
      .select("id,customer_id,processed_at,source_name,country_code,discount_codes,net_product_sales,discounts")
      .eq("store_id", store.id)
      .eq("currency", store.currency)
      .eq("test", false)
      .is("cancelled_at", null)
      .not("processed_at", "is", null);
    if (utcRange) query = query.gte("processed_at", utcRange.start).lt("processed_at", utcRange.endExclusive);
    if (cursor) query = query.or(`processed_at.lt.${cursor.processedAt},and(processed_at.eq.${cursor.processedAt},id.lt.${cursor.id})`);
    return query.order("processed_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  }, 1000);
  if (ordersError) return NextResponse.json({ error: ordersError }, { status: 500 });

  const orderChunks = chunks(orderRows.map((order) => order.id), 200);
  const [lineResult, refundResult, attributionResult, variantResult, costResult] = await Promise.all([
    selectAllPages<LineRow>((range) => Promise.all(orderChunks.map((ids) => supabase.from("shopify_order_lines").select("order_id,product_gid,title,variant_gid,sku,current_quantity,net_sales").in("order_id", ids).order("id", { ascending: true }).range(range.from, range.to))).then(mergeChunkPages)),
    selectAllPages<{ order_id: string; total_refunded: string | number }>((range) => Promise.all(orderChunks.map((ids) => supabase.from("shopify_refunds").select("order_id,total_refunded").in("order_id", ids).order("id", { ascending: true }).range(range.from, range.to))).then(mergeChunkPages)),
    selectAllPages<{ order_id: string; customer_order_index: number | null; landing_page: string | null }>((range) => Promise.all(orderChunks.map((ids) => supabase.from("shopify_order_attribution").select("order_id,customer_order_index,landing_page").eq("attribution_model", "last_touch").in("order_id", ids).order("id", { ascending: true }).range(range.from, range.to))).then(mergeChunkPages)),
    selectAllPages<{ id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null }>((range) => supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<EffectiveCost>((range) => supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id).order("id", { ascending: true }).range(range.from, range.to)),
  ]);
  const failure = [lineResult, refundResult, attributionResult, variantResult, costResult].find((result) => result.error)?.error;
  if (failure) return NextResponse.json({ error: failure }, { status: 500 });

  const refunds = new Map<string, number>();
  for (const refund of refundResult.rows) refunds.set(refund.order_id, (refunds.get(refund.order_id) ?? 0) + Number(refund.total_refunded));
  const indexByOrder = new Map(attributionResult.rows.map((row) => [row.order_id, row.customer_order_index]));
  const domainByOrder = new Map(attributionResult.rows.map((row) => [row.order_id, storeDomainFromUrl(row.landing_page)]));

  const variantsByGid = new Map(variantResult.rows.map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(variantResult.rows.filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of costResult.rows) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }

  const processedByOrder = new Map(orderRows.map((order) => [order.id, order.processed_at]));
  const orders: InsightOrder[] = orderRows.map((order) => ({
    id: order.id,
    customerId: order.customer_id,
    processedAt: order.processed_at,
    source: order.source_name,
    country: order.country_code,
    discountCodes: order.discount_codes ?? [],
    netSales: Number(order.net_product_sales) - (refunds.get(order.id) ?? 0),
    discounts: Number(order.discounts),
    customerIndex: indexByOrder.get(order.id) ?? null,
    storeDomain: domainByOrder.get(order.id) ?? null,
  }));
  const lines: InsightLine[] = lineResult.rows.flatMap((line) => {
    const processedAt = processedByOrder.get(line.order_id);
    if (!processedAt) return [];
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const costs = variant
      ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? []
      : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, processedAt.slice(0, 10), variant?.shopify_unit_cost == null ? null : monetary(variant.shopify_unit_cost));
    return [{ orderId: line.order_id, productKey: line.product_gid || line.title, product: line.title, units: Math.max(line.current_quantity, 0), netSales: Number(line.net_sales), unitCost }];
  });

  const insights = computeSalesInsights(orders, lines, store.timezone || "UTC");
  return NextResponse.json({ hasData: orders.length > 0, currency: store.currency, timezone: store.timezone || "UTC", ...insights });
}
