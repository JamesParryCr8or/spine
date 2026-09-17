import { NextResponse } from "next/server";

import { monetary } from "@/lib/analytics/effective-cost";
import { createClient } from "@/lib/supabase/server";

type Order = { id: string; net_product_sales: string };
type Attribution = { order_id: string; source: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; customer_order_index: number | null };

function valueOrDirect(value: string | null, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: orders, error: ordersError } = await supabase.from("shopify_orders").select("id,net_product_sales").eq("store_id", store.id).is("cancelled_at", null).eq("test", false);
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });
  const orderRows = (orders ?? []) as Order[];
  const orderIds = orderRows.map((order) => order.id);
  const { data: attributions, error: attributionError } = orderIds.length
    ? await supabase.from("shopify_order_attribution").select("order_id,source,utm_source,utm_medium,utm_campaign,customer_order_index").eq("attribution_model", "last_touch").in("order_id", orderIds)
    : { data: [], error: null };
  if (attributionError) return NextResponse.json({ error: attributionError.message }, { status: 500 });

  const orderById = new Map(orderRows.map((order) => [order.id, order]));
  const groups = new Map<string, { source: string; medium: string; campaign: string; sales: number; orders: number; newCustomerSales: number }>();
  for (const attribution of (attributions ?? []) as Attribution[]) {
    const order = orderById.get(attribution.order_id);
    if (!order) continue;
    const source = valueOrDirect(attribution.utm_source ?? attribution.source, "(direct)");
    const medium = valueOrDirect(attribution.utm_medium, source === "(direct)" ? "(none)" : "(unknown)");
    const campaign = valueOrDirect(attribution.utm_campaign, "—");
    const key = source + "\u0000" + medium + "\u0000" + campaign;
    const group = groups.get(key) ?? { source, medium, campaign, sales: 0, orders: 0, newCustomerSales: 0 };
    const sales = monetary(order.net_product_sales);
    group.sales += sales;
    group.orders += 1;
    if (attribution.customer_order_index === 1) group.newCustomerSales += sales;
    groups.set(key, group);
  }
  const rows = [...groups.values()].map((group) => ({ ...group, averageOrderValue: group.orders ? group.sales / group.orders : 0 })).sort((left, right) => right.sales - left.sales);
  const totals = rows.reduce((total, group) => ({ sales: total.sales + group.sales, orders: total.orders + group.orders, newCustomerSales: total.newCustomerSales + group.newCustomerSales }), { sales: 0, orders: 0, newCustomerSales: 0 });
  return NextResponse.json({ hasData: rows.length > 0, currency: store.currency, totals: { ...totals, averageOrderValue: totals.orders ? totals.sales / totals.orders : 0 }, rows });
}
