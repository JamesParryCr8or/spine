import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { calculateAcquisitionMetrics } from "@/lib/analytics/acquisition";
import { classifyCustomerOrders } from "@/lib/analytics/customer-classification";

type Order = {
  id: string;
  customer_id: string | null;
  processed_at: string | null;
  gross_sales: string;
  discounts: string;
  net_product_sales: string;
  shipping_revenue: string;
  total_sales: string;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: timezone }).format(date);
}

/**
 * Financial calculations stay on the server. All imported orders contribute to
 * the headline totals; the chart displays the six latest months in the store.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  if (membershipError || !membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id,currency,timezone")
    .eq("organization_id", membership.organization_id)
    .limit(1)
    .single();
  if (storeError || !store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const orders: Order[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("shopify_orders")
      .select("id,customer_id,processed_at,gross_sales,discounts,net_product_sales,shipping_revenue,total_sales")
      .eq("store_id", store.id)
      .is("cancelled_at", null)
      .eq("test", false)
      .not("processed_at", "is", null)
      .order("processed_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Order[];
    orders.push(...page);
    if (page.length < pageSize) break;
  }

  const latestOrderAt = orders.reduce<string | null>((latest, order) => !latest || (order.processed_at && order.processed_at > latest) ? order.processed_at : latest, null);
  const earliestOrderAt = orders[0]?.processed_at ?? null;
  const chartEnd = latestOrderAt ? new Date(latestOrderAt) : new Date();
  const chartStart = new Date(Date.UTC(chartEnd.getUTCFullYear(), chartEnd.getUTCMonth() - 5, 1));
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(chartEnd.getUTCFullYear(), chartEnd.getUTCMonth() - (5 - index), 1));
    return { key: date.toISOString().slice(0, 7), label: monthLabel(date, store.timezone || "UTC"), grossSales: 0, discounts: 0, netSales: 0, shippingRevenue: 0, orders: 0 };
  });
  const periods = new Map(months.map((month) => [month.key, month]));
  let grossSales = 0;
  let discounts = 0;
  let netSales = 0;
  let shippingRevenue = 0;
  let newCustomerSales = 0;
  const customerClasses = classifyCustomerOrders(orders.map((order) => ({ id: order.id, customerId: order.customer_id, processedAt: order.processed_at })));

  for (const order of orders) {
    if (!order.processed_at) continue;
    const key = order.processed_at.slice(0, 7);
    const period = periods.get(key);
    const gross = Number(order.gross_sales) || 0;
    const discount = Number(order.discounts) || 0;
    const net = Number(order.net_product_sales) || 0;
    const shipping = Number(order.shipping_revenue) || 0;
    grossSales += gross;
    discounts += discount;
    netSales += net;
    shippingRevenue += shipping;
    if (customerClasses.get(order.id) === "new") newCustomerSales += net;
    if (period) {
      period.grossSales += gross;
      period.discounts += discount;
      period.netSales += net;
      period.shippingRevenue += shipping;
      period.orders += 1;
    }
  }

  let metaQuery = supabase.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).eq("currency", store.currency).order("date_start", { ascending: true });
  if (earliestOrderAt) metaQuery = metaQuery.gte("date_start", earliestOrderAt.slice(0, 10));
  if (latestOrderAt) metaQuery = metaQuery.lte("date_start", latestOrderAt.slice(0, 10));
  const { data: metaRows, error: metaError } = await metaQuery;
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 500 });
  const orderCount = orders.length;
  const includedOrderIds = new Set(orders.map((order) => order.id));
  let unitsSold = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("shopify_order_lines").select("order_id,current_quantity").eq("store_id", store.id).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const line of data ?? []) if (includedOrderIds.has(line.order_id)) unitsSold += Math.max(line.current_quantity, 0);
    if ((data ?? []).length < pageSize) break;
  }
  const metaDates = (metaRows ?? []).map((row) => row.date_start);
  const marketingSpend = (metaRows ?? []).reduce((total, row) => total + (Number(row.spend) || 0), 0);
  const newCustomers = [...customerClasses.values()].filter((classification) => classification === "new").length;
  const acquisition = calculateAcquisitionMetrics({ netSales, newCustomerSales, marketingSpend, newCustomers });
  return NextResponse.json({
    hasData: orderCount > 0,
    currency: store.currency,
    range: { start: earliestOrderAt ? isoDate(new Date(earliestOrderAt)) : isoDate(chartStart), end: latestOrderAt ? isoDate(chartEnd) : isoDate(chartEnd) },
    metrics: {
      grossSales,
      discounts,
      netSales,
      shippingRevenue,
      orders: orderCount,
      unitsSold,
      averageOrderValue: orderCount ? netSales / orderCount : 0,
      marketingSpend,
      newCustomers,
      newCustomerSales,
      ...acquisition,
    },
    months,
    meta: { importedDays: metaDates.length, start: metaDates[0] ?? null, end: metaDates.at(-1) ?? null },
  });
}
