import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";
import { classifyCustomerOrders } from "@/lib/analytics/customer-classification";

type Order = {
  id: string;
  customer_id: string | null;
  processed_at: string | null;
  net_product_sales: string;
  shipping_revenue: string;
  currency: string;
  exchange_rate: number;
};

const money = (value: string | null | undefined) => Number(value ?? 0);

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership } = await supabase.from("organization_members").select("organization_id,role").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: exchangeRateRows, error: exchangeRateError } = await supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true });
  if (exchangeRateError) return NextResponse.json({ error: exchangeRateError.message }, { status: 500 });
  const exchangeRates = (exchangeRateRows ?? []) as DatedExchangeRate[];
  const orders: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("shopify_orders")
      .select("id,customer_id,processed_at,net_product_sales,shipping_revenue,currency")
      .eq("store_id", store.id)
      .eq("test", false)
      .is("cancelled_at", null)
      .not("processed_at", "is", null)
      .order("processed_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Array<Omit<Order, "exchange_rate">>;
    for (const order of page) {
      const exchangeRate = resolveDatedExchangeRate(exchangeRates, order.currency, store.currency, order.processed_at ?? "");
      if (currencyCoverage.include(order.currency, exchangeRate)) orders.push({ ...order, exchange_rate: exchangeRate ?? 1 });
    }
    if (page.length < pageSize) break;
  }
  const ordersByCustomer = new Map<string, Order[]>();
  const customerClasses = classifyCustomerOrders(orders.map((order) => ({ id: order.id, customerId: order.customer_id, processedAt: order.processed_at })));
  let guestOrders = 0;
  let guestSales = 0;
  for (const order of orders) {
    const sales = convertDatedAmount(money(order.net_product_sales) + money(order.shipping_revenue), order.exchange_rate, store.currency);
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
  const cohortRows = new Map<string, { key: string; customerIds: Set<string>; periods: Map<number, { customerIds: Set<string>; revenue: number }> }>();
  const monthNumber = (key: string) => {
    const [year, month] = key.split("-").map(Number);
    return year * 12 + month - 1;
  };
  for (const [customerId, customerOrders] of ordersByCustomer) {
    const cohortKey = monthFor(customerOrders[0]?.processed_at);
    if (!cohortKey) continue;
    const cohort = cohortRows.get(cohortKey) ?? { key: cohortKey, customerIds: new Set<string>(), periods: new Map<number, { customerIds: Set<string>; revenue: number }>() };
    cohort.customerIds.add(customerId);
    for (const order of customerOrders) {
      const orderKey = monthFor(order.processed_at);
      if (!orderKey) continue;
      const period = monthNumber(orderKey) - monthNumber(cohortKey);
      if (period < 0 || period > 11) continue;
      const current = cohort.periods.get(period) ?? { customerIds: new Set<string>(), revenue: 0 };
      current.customerIds.add(customerId);
      current.revenue += convertDatedAmount(money(order.net_product_sales) + money(order.shipping_revenue), order.exchange_rate, store.currency);
      cohort.periods.set(period, current);
    }
    cohortRows.set(cohortKey, cohort);
  }
  const cohorts = [...cohortRows.values()]
    .sort((left, right) => right.key.localeCompare(left.key))
    .slice(0, 12)
    .map((cohort) => ({
      key: cohort.key,
      customers: cohort.customerIds.size,
      periods: (() => {
        let cumulativeRevenue = 0;
        return Array.from({ length: 7 }, (_, period) => {
          const current = cohort.periods.get(period);
          const activeCustomers = current?.customerIds.size ?? 0;
          const revenue = current?.revenue ?? 0;
          cumulativeRevenue += revenue;
          return { period, activeCustomers, retentionRate: cohort.customerIds.size ? activeCustomers / cohort.customerIds.size : 0, revenue, cumulativeRevenue };
        });
      })(),
    }));
  for (const customerOrders of customers) {
    customerOrders.forEach((order) => {
      const sales = convertDatedAmount(money(order.net_product_sales) + money(order.shipping_revenue), order.exchange_rate, store.currency);
      const key = monthFor(order.processed_at);
      const month = key ? months.get(key) ?? { key, newCustomerOrders: 0, newCustomerSales: 0, repeatCustomerOrders: 0, repeatCustomerSales: 0 } : null;
      if (customerClasses.get(order.id) === "new") {
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
  const timeToSecondOrderDays = customers.flatMap((customerOrders) => {
    const first = customerOrders[0]?.processed_at;
    const second = customerOrders[1]?.processed_at;
    return first && second ? [(Date.parse(second) - Date.parse(first)) / (24 * 60 * 60 * 1000)] : [];
  });
  const identifiedOrders = newCustomerOrders + repeatCustomerOrders;
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
    currencyCoverage: currencyCoverage.summary(),
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
      repeatOrderRate: identifiedOrders ? repeatCustomerOrders / identifiedOrders : null,
      newCustomerAverageOrderValue: newCustomerOrders ? newCustomerSales / newCustomerOrders : null,
      repeatCustomerAverageOrderValue: repeatCustomerOrders ? repeatCustomerSales / repeatCustomerOrders : null,
      averageOrdersPerCustomer: customers.length ? identifiedOrders / customers.length : null,
      averageCustomerValue: customers.length ? (newCustomerSales + repeatCustomerSales) / customers.length : null,
      averageDaysToSecondOrder: timeToSecondOrderDays.length ? timeToSecondOrderDays.reduce((total, days) => total + days, 0) / timeToSecondOrderDays.length : null,
    },
    customerDetailsMasked: !["owner", "admin", "analyst"].includes(membership.role),
    customers: (recentCustomers.data ?? []).map((customer, index) => ({
      ...customer,
      display_name: ["owner", "admin", "analyst"].includes(membership.role) ? customer.display_name : `Customer ${index + 1}`,
      email: null,
    })),
    months: [...months.values()].sort((left, right) => left.key.localeCompare(right.key)),
    cohorts,
  });
}
