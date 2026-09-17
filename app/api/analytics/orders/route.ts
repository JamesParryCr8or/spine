import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: orders, error } = await supabase
    .from("shopify_orders")
    .select("id,order_name,processed_at,financial_status,fulfillment_status,source_name,net_product_sales,shipping_revenue,total_sales,currency")
    .eq("store_id", store.id)
    .eq("test", false)
    .order("processed_at", { ascending: false })
    .limit(250);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hasData: (orders ?? []).length > 0, currency: store.currency, orders: orders ?? [] });
}
