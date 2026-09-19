import { NextResponse } from "next/server";

import { reportingDateKey, reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { requireWorkspace } from "@/lib/workspace/server";

type OrderRow = {
  id: string; customer_id: string | null; order_name: string; processed_at: string | null;
  financial_status: string | null; fulfillment_status: string | null; source_name: string | null; country_code: string | null; discount_codes: string[];
  net_product_sales: string | number; shipping_revenue: string | number; total_sales: string | number; currency: string;
};
type BreakdownRow = { label: string; orders: number; units: number; sales: number };

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
  const lineRows: Array<{ order_id: string; title: string; variant_title: string | null; current_quantity: number; net_sales: string | number }> = [];
  const attributionRows: Array<{ order_id: string; customer_order_index: number | null }> = [];
  for (let index = 0; index < orderIds.length; index += 200) {
    const ids = orderIds.slice(index, index + 200);
    const [refundResult, lineResult, attributionResult] = await Promise.all([
      supabase.from("shopify_refunds").select("order_id,total_refunded").in("order_id", ids),
      supabase.from("shopify_order_lines").select("order_id,title,variant_title,current_quantity,net_sales").in("order_id", ids),
      supabase.from("shopify_order_attribution").select("order_id,customer_order_index").eq("attribution_model", "last_touch").in("order_id", ids),
    ]);
    const error = refundResult.error ?? lineResult.error ?? attributionResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    refundRows.push(...(refundResult.data ?? []));
    lineRows.push(...(lineResult.data ?? []));
    attributionRows.push(...(attributionResult.data ?? []));
  }

  const refundsByOrder = new Map<string, number>();
  for (const refund of refundRows) refundsByOrder.set(refund.order_id, (refundsByOrder.get(refund.order_id) ?? 0) + Number(refund.total_refunded));
  const unitsByOrder = new Map<string, number>();
  for (const line of lineRows) unitsByOrder.set(line.order_id, (unitsByOrder.get(line.order_id) ?? 0) + line.current_quantity);
  const customerIndexByOrder = new Map(attributionRows.map((row) => [row.order_id, row.customer_order_index]));

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

  const orderDates = orderRows.flatMap((order) => order.processed_at ? [reportingDateKey(order.processed_at, store.timezone || "UTC")] : []).sort();
  return NextResponse.json({
    hasData: orderRows.length > 0,
    currency: store.currency,
    timezone: store.timezone || "UTC",
    period: orderDates.length ? { start: orderDates[0], end: orderDates.at(-1) } : null,
    analysisOrderCount: orderRows.length,
    breakdowns: {
      date: sorted(dateMap, true),
      channel: sorted(channelMap),
      customerType: sorted(customerMap),
      country: sorted(countryMap),
      discountCode: sorted(discountMap),
      product: sorted(productMap).slice(0, 100),
    },
    orders: orderRows.slice(0, 250).map((order) => ({ ...order, refunded: refundsByOrder.get(order.id) ?? 0 })),
  });
}
