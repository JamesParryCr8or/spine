import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type Order = {
  id: string;
  customer_id: string | null;
  processed_at: string | null;
  net_product_sales: string;
  shipping_revenue: string;
};

const money = (value: string | null | undefined) => Number(value ?? 0);

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: rawOrders, error } = await supabase
    .from("shopify_orders")
    .select("id,customer_id,processed_at,net_product_sales,shipping_revenue")
    .eq("store_id", store.id)
    .eq("test", false)
    .is("cancelled_at", null)
    .not("processed_at", "is", null)
    .order("processed_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = (rawOrders ?? []) as Order[];
  const ordersByCustomer = new Map<string, Order[]>();
  let guestOrders = 0;
  let guestSales = 0;
  for (const order of orders) {
    const sales = money(order.net_product_sales) + money(order.shipping_revenue);
    if (!order.customer_id) {
      guestOrders += 1;
      guestSales += sales;
      continue;
    }
    ordersByCustomer.set(order.customer_id, [...(ordersByCustomer.get(order.customer_id) ?? []), order]);
  }

  let newCustomerOrders = 0;
  let newCustomerSales = 0;
  let repeatCustomerOrders = 0;
  let repeatCustomerSales = 0;
  const months = new Map<string, { key: string; newCustomerOrders: number; newCustomerSales: number; repeatCustomerOrders: number; repeatCustomerSales: number }>();
  const monthFor = (date: string | null) => date ? date.slice(0, 7) : null;
  const customers = [...ordersByCustomer.values()];
  for (const customerOrders of customers) {
    customerOrders.forEach((order, index) => {
      const sales = money(order.net_product_sales) + money(order.shipping_revenue);
      const key = monthFor(order.processed_at);
      const month = key ? months.get(key) ?? { key, newCustomerOrders: 0, newCustomerSales: 0, repeatCustomerOrders: 0, repeatCustomerSales: 0 } : null;
      if (index === 0) {
        newCustomerOrders += 1;
        newCustomerSales += sales;
        if (month) { month.newCustomerOrders += 1; month.newCustomerSales += sales; }
      } else {
        repeatCustomerOrders += 1;
        repeatCustomerSales += sales;
        if (month) { month.repeatCustomerOrders += 1; month.repeatCustomerSales += sales; }
      }
      if (month && key) months.set(key, month);
    });
  }

  const totalSales = newCustomerSales + repeatCustomerSales + guestSales;
  const repeatCustomers = customers.filter((customerOrders) => customerOrders.length > 1).length;
  const recentCustomers = await supabase
    .from("shopify_customers")
    .select("id,display_name,email,number_of_orders,amount_spent,currency,updated_at_shopify")
    .eq("store_id", store.id)
    .order("amount_spent", { ascending: false })
    .limit(50);
  if (recentCustomers.error) return NextResponse.json({ error: recentCustomers.error.message }, { status: 500 });

  return NextResponse.json({
    hasData: orders.length > 0,
    currency: store.currency,
    metrics: {
      customers: customers.length,
      repeatCustomers,
      repeatCustomerRate: customers.length ? repeatCustomers / customers.length : null,
      newCustomerOrders,
      newCustomerSales,
      repeatCustomerOrders,
      repeatCustomerSales,
      guestOrders,
      guestSales,
      repeatRevenueRate: totalSales ? repeatCustomerSales / totalSales : null,
    },
    customers: recentCustomers.data ?? [],
    months: [...months.values()].sort((left, right) => left.key.localeCompare(right.key)),
  });
}
