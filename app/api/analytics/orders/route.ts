import { NextResponse } from "next/server";

import { reportingDateKey, reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { costKey, monetary, resolveEffectiveCost, type EffectiveCost } from "@/lib/analytics/effective-cost";
import { requireWorkspace } from "@/lib/workspace/server";

type OrderRow = {
  id: string; customer_id: string | null; order_name: string; processed_at: string | null;
  financial_status: string | null; fulfillment_status: string | null; source_name: string | null; country_code: string | null; discount_codes: string[];
  net_product_sales: string | number; shipping_revenue: string | number; total_sales: string | number; currency: string;
};
type BreakdownRow = { label: string; orders: number; units: number; sales: number };
type DailyShopifyRow = {
  sales_date: string; gross_sales: string | number; discounts: string | number;
  sales_reversals: string | number; net_sales: string | number; shipping_charges: string | number;
  taxes: string | number; total_sales: string | number; orders: number; net_items_sold: number;
  cost_of_goods_sold: string | number; gross_profit: string | number;
  net_sales_with_cost_recorded: string | number; net_sales_without_cost_recorded: string | number;
  total_payment_fees: string | number;
};

function addBreakdown(map: Map<string, BreakdownRow>, label: string, orderId: string, units: number, sales: number, seen: Map<string, Set<string>>) {
  const row = map.get(label) ?? { label, orders: 0, units: 0, sales: 0 };
  const orders = seen.get(label) ?? new Set<string>();
  if (!orders.has(orderId)) { row.orders += 1; orders.add(orderId); seen.set(label, orders); }
  row.units += units;
  row.sales += sales;
  map.set(label, row);
}

function sorted(map: Map<string, BreakdownRow>, chronological = false) {
  return [...map.values()].sort((left, right) => chronological ? left.label.localeCompare(right.label) : right.sales - left.sales);
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

  const orderRows: OrderRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("shopify_orders")
      .select("id,customer_id,order_name,processed_at,financial_status,fulfillment_status,source_name,country_code,discount_codes,net_product_sales,shipping_revenue,total_sales,currency")
      .eq("store_id", store.id)
      .eq("currency", store.currency)
      .eq("test", false);
    if (utcRange) query = query.gte("processed_at", utcRange.start).lt("processed_at", utcRange.endExclusive);
    const { data, error } = await query.order("processed_at", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as OrderRow[];
    orderRows.push(...page);
    if (page.length < pageSize) break;
  }

  const orderIds = orderRows.map((order) => order.id);
  const refundRows: Array<{ order_id: string; total_refunded: string | number }> = [];
  const lineRows: Array<{ order_id: string; title: string; variant_title: string | null; variant_gid: string | null; sku: string | null; current_quantity: number; net_sales: string | number }> = [];
  const attributionRows: Array<{ order_id: string; customer_order_index: number | null }> = [];
  const transactionRows: Array<{ order_id: string; status: string; fee_amount: string | number; fee_tax: string | number }> = [];
  for (let index = 0; index < orderIds.length; index += 200) {
    const ids = orderIds.slice(index, index + 200);
    const [refundResult, lineResult, attributionResult, transactionResult] = await Promise.all([
      supabase.from("shopify_refunds").select("order_id,total_refunded").in("order_id", ids),
      supabase.from("shopify_order_lines").select("order_id,title,variant_title,variant_gid,sku,current_quantity,net_sales").in("order_id", ids),
      supabase.from("shopify_order_attribution").select("order_id,customer_order_index").eq("attribution_model", "last_touch").in("order_id", ids),
      supabase.from("shopify_transactions").select("order_id,status,fee_amount,fee_tax").in("order_id", ids),
    ]);
    const error = refundResult.error ?? lineResult.error ?? attributionResult.error ?? transactionResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    refundRows.push(...(refundResult.data ?? []));
    lineRows.push(...(lineResult.data ?? []));
    attributionRows.push(...(attributionResult.data ?? []));
    transactionRows.push(...(transactionResult.data ?? []));
  }

  const refundsByOrder = new Map<string, number>();
  for (const refund of refundRows) refundsByOrder.set(refund.order_id, (refundsByOrder.get(refund.order_id) ?? 0) + Number(refund.total_refunded));
  const unitsByOrder = new Map<string, number>();
  for (const line of lineRows) unitsByOrder.set(line.order_id, (unitsByOrder.get(line.order_id) ?? 0) + line.current_quantity);
  const customerIndexByOrder = new Map(attributionRows.map((row) => [row.order_id, row.customer_order_index]));
  const dateByOrder = new Map(orderRows.map((order) => [
    order.id,
    order.processed_at ? reportingDateKey(order.processed_at, store.timezone || "UTC") : "Unknown date",
  ]));
  const paymentFeesByDate = new Map<string, number>();
  for (const transaction of transactionRows) {
    if (transaction.status !== "SUCCESS") continue;
    const date = dateByOrder.get(transaction.order_id);
    if (!date || date === "Unknown date") continue;
    const fee = Number(transaction.fee_amount) + Number(transaction.fee_tax);
    paymentFeesByDate.set(date, (paymentFeesByDate.get(date) ?? 0) + (Number.isFinite(fee) ? fee : 0));
  }

  const [variantResult, costResult] = await Promise.all([
    supabase.from("shopify_variants").select("id,shopify_gid,sku,shopify_unit_cost").eq("store_id", store.id),
    supabase.from("product_costs").select("variant_id,sku,amount,effective_from,effective_to,source").eq("store_id", store.id),
  ]);
  if (variantResult.error || costResult.error) return NextResponse.json({ error: (variantResult.error ?? costResult.error)!.message }, { status: 500 });
  const variants = (variantResult.data ?? []) as Array<{ id: string; shopify_gid: string; sku: string | null; shopify_unit_cost: string | null }>;
  const variantsByGid = new Map(variants.map((variant) => [variant.shopify_gid, variant]));
  const variantsBySku = new Map(variants.filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));
  const costsByKey = new Map<string, EffectiveCost[]>();
  for (const cost of (costResult.data ?? []) as EffectiveCost[]) {
    const key = costKey(cost);
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }
  const ordersById = new Map(orderRows.map((order) => [order.id, order]));
  const localCogsByDate = new Map<string, { cogs: number; missingCostLines: number }>();
  for (const line of lineRows) {
    const order = ordersById.get(line.order_id);
    const date = dateByOrder.get(line.order_id);
    if (!order?.processed_at || !date || date === "Unknown date") continue;
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : line.sku ? variantsBySku.get(line.sku.trim().toLowerCase()) : undefined;
    const costs = variant
      ? costsByKey.get(`variant:${variant.id}`) ?? costsByKey.get(`sku:${variant.sku?.trim().toLowerCase()}`) ?? []
      : costsByKey.get(`sku:${line.sku?.trim().toLowerCase()}`) ?? [];
    const unitCost = resolveEffectiveCost(costs, order.processed_at.slice(0, 10), variant?.shopify_unit_cost == null ? null : monetary(variant.shopify_unit_cost));
    const aggregate = localCogsByDate.get(date) ?? { cogs: 0, missingCostLines: 0 };
    if (unitCost === null) aggregate.missingCostLines += 1;
    else aggregate.cogs += unitCost * Math.max(line.current_quantity, 0);
    localCogsByDate.set(date, aggregate);
  }

  const dateMap = new Map<string, BreakdownRow>(), channelMap = new Map<string, BreakdownRow>(), customerMap = new Map<string, BreakdownRow>(), productMap = new Map<string, BreakdownRow>(), countryMap = new Map<string, BreakdownRow>(), discountMap = new Map<string, BreakdownRow>();
  const dateSeen = new Map<string, Set<string>>(), channelSeen = new Map<string, Set<string>>(), customerSeen = new Map<string, Set<string>>(), productSeen = new Map<string, Set<string>>(), countrySeen = new Map<string, Set<string>>(), discountSeen = new Map<string, Set<string>>();
  for (const order of orderRows) {
    const units = unitsByOrder.get(order.id) ?? 0;
    const sales = Number(order.net_product_sales) - (refundsByOrder.get(order.id) ?? 0);
    const date = order.processed_at ? reportingDateKey(order.processed_at, store.timezone || "UTC") : "Unknown date";
    const channel = order.source_name || "Unknown source";
    const customerIndex = customerIndexByOrder.get(order.id);
    const customerType = !order.customer_id ? "Guest" : customerIndex === 1 ? "New customer" : customerIndex && customerIndex > 1 ? "Repeat customer" : "Known customer";
    addBreakdown(dateMap, date, order.id, units, sales, dateSeen);
    addBreakdown(channelMap, channel, order.id, units, sales, channelSeen);
    addBreakdown(customerMap, customerType, order.id, units, sales, customerSeen);
    addBreakdown(countryMap, order.country_code || "Unknown country", order.id, units, sales, countrySeen);
    const discountCodes = order.discount_codes.length ? order.discount_codes : ["No discount code"];
    for (const code of discountCodes) addBreakdown(discountMap, code, order.id, units / discountCodes.length, sales / discountCodes.length, discountSeen);
  }
  for (const line of lineRows) {
    const label = line.variant_title ? `${line.title} · ${line.variant_title}` : line.title;
    addBreakdown(productMap, label, line.order_id, line.current_quantity, Number(line.net_sales), productSeen);
  }

  let dailyQuery = supabase
    .from("shopify_sales_daily")
    .select("sales_date,gross_sales,discounts,sales_reversals,net_sales,shipping_charges,taxes,total_sales,orders,net_items_sold,cost_of_goods_sold,gross_profit,net_sales_with_cost_recorded,net_sales_without_cost_recorded,total_payment_fees")
    .eq("store_id", store.id)
    .order("sales_date", { ascending: true });
  if (from) dailyQuery = dailyQuery.gte("sales_date", from);
  if (to) dailyQuery = dailyQuery.lte("sales_date", to);
  const { data: dailyData, error: dailyError } = await dailyQuery;
  if (dailyError) return NextResponse.json({ error: dailyError.message }, { status: 500 });
  const shopifyDaily = (dailyData ?? []) as DailyShopifyRow[];
  const dailyBreakdown = shopifyDaily.map((row) => {
    const localCost = localCogsByDate.get(row.sales_date);
    const useLocalCost = Boolean(localCost && localCost.missingCostLines === 0);
    const cogs = useLocalCost ? localCost!.cogs : Number(row.cost_of_goods_sold);
    return {
      label: row.sales_date,
      orders: row.orders,
      units: row.net_items_sold,
      sales: Number(row.net_sales),
      grossSales: Number(row.gross_sales),
      discounts: Number(row.discounts),
      refunds: Math.abs(Number(row.sales_reversals)),
      shipping: Number(row.shipping_charges),
      taxes: Number(row.taxes),
      totalSales: Number(row.total_sales),
      cogs,
      grossProfit: Number(row.net_sales) - cogs,
      missingCostLines: localCost?.missingCostLines ?? 0,
      salesWithoutRecordedCost: useLocalCost ? 0 : Number(row.net_sales_without_cost_recorded),
      paymentFees: Number(row.total_payment_fees) || paymentFeesByDate.get(row.sales_date) || 0,
    };
  });

  const orderDates = orderRows.flatMap((order) => order.processed_at ? [reportingDateKey(order.processed_at, store.timezone || "UTC")] : []).sort();
  return NextResponse.json({
    hasData: orderRows.length > 0,
    currency: store.currency,
    timezone: store.timezone || "UTC",
    period: orderDates.length ? { start: orderDates[0], end: orderDates.at(-1) } : null,
    analysisOrderCount: orderRows.length,
    dailySource: dailyBreakdown.length ? "shopifyql" : "imported_orders",
    breakdowns: {
      date: dailyBreakdown.length ? dailyBreakdown : sorted(dateMap, true),
      channel: sorted(channelMap),
      customerType: sorted(customerMap),
      country: sorted(countryMap),
      discountCode: sorted(discountMap),
      product: sorted(productMap).slice(0, 100),
    },
    orders: orderRows.slice(0, 250).map((order) => ({ ...order, refunded: refundsByOrder.get(order.id) ?? 0 })),
  });
}
