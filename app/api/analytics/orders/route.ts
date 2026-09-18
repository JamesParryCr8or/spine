import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency,timezone").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: orders, error } = await supabase
    .from("shopify_orders")
    .select("id,order_name,processed_at,financial_status,fulfillment_status,source_name,net_product_sales,shipping_revenue,total_sales,currency")
    .eq("store_id", store.id)
    .eq("currency", store.currency)
    .eq("test", false)
    .order("processed_at", { ascending: false })
    .limit(250);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const orderRows = orders ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const { data: refunds, error: refundsError } = orderIds.length ? await supabase.from("shopify_refunds").select("order_id,total_refunded").in("order_id", orderIds) : { data: [], error: null };
  if (refundsError) return NextResponse.json({ error: refundsError.message }, { status: 500 });
  const refundsByOrder = new Map<string, number>();
  for (const refund of refunds ?? []) refundsByOrder.set(refund.order_id, (refundsByOrder.get(refund.order_id) ?? 0) + Number(refund.total_refunded));
  const orderDates = orderRows.flatMap((order) => order.processed_at ? [order.processed_at.slice(0, 10)] : []).sort();
  return NextResponse.json({ hasData: orderRows.length > 0, currency: store.currency, timezone: store.timezone || "UTC", period: orderDates.length ? { start: orderDates[0], end: orderDates.at(-1) } : null, orders: orderRows.map((order) => ({ ...order, refunded: refundsByOrder.get(order.id) ?? 0 })) });
}
