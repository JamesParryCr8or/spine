import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type Order = {
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
 * First live dashboard slice. Financial calculations remain on the server so
 * browser components do not recreate Shopify totals from raw records.
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

  const end = new Date();
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 5);
  start.setUTCDate(1);

  const { data: orders, error: ordersError } = await supabase
    .from("shopify_orders")
    .select("processed_at,gross_sales,discounts,net_product_sales,shipping_revenue,total_sales")
    .eq("store_id", store.id)
    .is("cancelled_at", null)
    .eq("test", false)
    .gte("processed_at", start.toISOString())
    .lte("processed_at", end.toISOString())
    .order("processed_at", { ascending: true });
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });

  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (5 - index), 1));
    return { key: date.toISOString().slice(0, 7), label: monthLabel(date, store.timezone || "UTC"), grossSales: 0, discounts: 0, netSales: 0, shippingRevenue: 0, orders: 0 };
  });
  const periods = new Map(months.map((month) => [month.key, month]));
  let grossSales = 0;
  let discounts = 0;
  let netSales = 0;
  let shippingRevenue = 0;

  for (const order of (orders ?? []) as Order[]) {
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
    if (period) {
      period.grossSales += gross;
      period.discounts += discount;
      period.netSales += net;
      period.shippingRevenue += shipping;
      period.orders += 1;
    }
  }

  const orderCount = orders?.length ?? 0;
  return NextResponse.json({
    hasData: orderCount > 0,
    currency: store.currency,
    range: { start: isoDate(start), end: isoDate(end) },
    metrics: {
      grossSales,
      discounts,
      netSales,
      shippingRevenue,
      orders: orderCount,
      averageOrderValue: orderCount ? netSales / orderCount : 0,
    },
    months,
  });
}
