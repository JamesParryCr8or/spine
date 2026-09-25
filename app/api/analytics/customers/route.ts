import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";
import { classifyCustomerOrders } from "@/lib/analytics/customer-classification";
import { bucketRepeatOrderGaps } from "@/lib/analytics/repeat-order-gaps";
import { reportingRangeToUtc } from "@/lib/analytics/reporting-range";

type Order = {
  id: string;
  customer_id: string | null;
  processed_at: string | null;
  net_product_sales: string;
  shipping_revenue: string;
  currency: string;
  exchange_rate: number;
  country_code: string | null;
};
type OrderLine = { order_id: string; product_gid: string | null; sku: string | null; title: string; current_quantity: number };

const money = (value: string | null | undefined) => Number(value ?? 0);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if ((fromDate && !isDate(fromDate)) || (toDate && !isDate(toDate)) || (fromDate && toDate && fromDate > toDate)) return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store, membership } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: exchangeRateRows, error: exchangeRateError } = await supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true });
  if (exchangeRateError) return NextResponse.json({ error: exchangeRateError.message }, { status: 500 });
  const exchangeRates = (exchangeRateRows ?? []) as DatedExchangeRate[];
  const orders: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("shopify_orders")
      .select("id,customer_id,processed_at,net_product_sales,shipping_revenue,currency,country_code")
      .eq("store_id", store.id)
      .eq("test", false)
      .is("cancelled_at", null)
      .not("processed_at", "is", null);
    if (fromDate) query = query.gte("processed_at", reportingRangeToUtc(fromDate, fromDate, store.timezone || "UTC").start);
    if (toDate) query = query.lt("processed_at", reportingRangeToUtc(toDate, toDate, store.timezone || "UTC").endExclusive);
    const { data, error } = await query.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Array<Omit<Order, "exchange_rate">>;
    for (const order of page) {
      const exchangeRate = resolveDatedExchangeRate(exchangeRates, order.currency, store.currency, order.processed_at ?? "");
      if (currencyCoverage.include(order.currency, exchangeRate)) orders.push({ ...order, exchange_rate: exchangeRate ?? 1 });
    }
    if (page.length < pageSize) break;
  }
  const ordersByCustomer = new Map<string, Order[]>();
  const locationTotals = new Map<string, { orders: number; sales: number; customers: Set<string> }>();
  const latestCountryByCustomer = new Map<string, string>();
  const classificationOrders: Array<{ id: string; customerId: string | null; processedAt: string | null }> = [];
  for (let from = 0; ; from += pageSize) {
    let historyQuery = supabase.from("shopify_orders").select("id,customer_id,processed_at").eq("store_id", store.id).eq("test", false).is("cancelled_at", null).not("processed_at", "is", null);
    if (toDate) historyQuery = historyQuery.lt("processed_at", reportingRangeToUtc(toDate, toDate, store.timezone || "UTC").endExclusive);
    const { data, error } = await historyQuery.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = data ?? [];
    classificationOrders.push(...page.map((order) => ({ id: order.id, customerId: order.customer_id, processedAt: order.processed_at })));
    if (page.length < pageSize) break;
  }
  const customerClasses = classifyCustomerOrders(classificationOrders);
  let guestOrders = 0;
  let guestSales = 0;
  for (const order of orders) {
    const sales = convertDatedAmount(money(order.net_product_sales) + money(order.shipping_revenue), order.exchange_rate, store.currency);
    const countryCode = order.country_code?.trim().toUpperCase();
    if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
      const location = locationTotals.get(countryCode) ?? { orders: 0, sales: 0, customers: new Set<string>() };
      location.orders += 1;
      location.sales += sales;
      if (order.customer_id) { location.customers.add(order.customer_id); latestCountryByCustomer.set(order.customer_id, countryCode); }
      locationTotals.set(countryCode, location);
    }
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
  const orderLines: OrderLine[] = [];
  const analysedOrderIds = orders.map((order) => order.id);
  for (let from = 0; from < analysedOrderIds.length; from += 500) {
    const { data, error } = await supabase.from("shopify_order_lines").select("order_id,product_gid,sku,title,current_quantity").in("order_id", analysedOrderIds.slice(from, from + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    orderLines.push(...(data ?? []) as OrderLine[]);
  }
  const linesByOrder = new Map<string, OrderLine[]>();
  for (const line of orderLines) linesByOrder.set(line.order_id, [...(linesByOrder.get(line.order_id) ?? []), line]);
  const repurchaseWindows = [30, 60, 90, 180, 365].map((days) => {
    let eligible = 0;
    let repurchased = 0;
    for (const customerOrders of customers) {
      const first = customerOrders[0]?.processed_at;
      if (!first) continue;
      eligible += 1;
      const firstAt = Date.parse(first);
      if (customerOrders.slice(1).some((order) => order.processed_at && Date.parse(order.processed_at) - firstAt <= days * 86400000)) repurchased += 1;
    }
    return { days, customers: eligible, repurchased, rate: eligible ? repurchased / eligible : null };
  });
  const gaps = customers.flatMap((customerOrders) => customerOrders.slice(1).flatMap((order, index) => {
    const previous = customerOrders[index]?.processed_at;
    return previous && order.processed_at ? [(Date.parse(order.processed_at) - Date.parse(previous)) / 86400000] : [];
  })).filter((value) => value >= 0);
  const timeBetweenOrders = bucketRepeatOrderGaps(gaps);
  const productBreakdowns = new Map<string, { product: string; sku: string | null; customers: Set<string>; repurchasers: Set<string>; sameProductRepurchasers: Set<string>; sales: number; gaps: number[] }>();
  const journeys = new Map<string, { from: string; to: string; customers: Set<string> }>();
  for (const [customerId, customerOrders] of ordersByCustomer) {
    const firstOrder = customerOrders[0];
    if (!firstOrder) continue;
    const firstLines = linesByOrder.get(firstOrder.id) ?? [];
    const laterOrders = customerOrders.slice(1);
    const laterKeys = new Set(laterOrders.flatMap((order) => (linesByOrder.get(order.id) ?? []).map((line) => line.product_gid ?? `sku:${line.sku ?? line.title}`)));
    const customerSales = customerOrders.reduce((total, order) => total + convertDatedAmount(money(order.net_product_sales) + money(order.shipping_revenue), order.exchange_rate, store.currency), 0);
    const customerGaps = laterOrders.flatMap((order, index) => {
      const previous = customerOrders[index]?.processed_at;
      return previous && order.processed_at ? [(Date.parse(order.processed_at) - Date.parse(previous)) / 86400000] : [];
    });
    for (const firstLine of firstLines) {
      const key = firstLine.product_gid ?? `sku:${firstLine.sku ?? firstLine.title}`;
      const row = productBreakdowns.get(key) ?? { product: firstLine.title, sku: firstLine.sku, customers: new Set<string>(), repurchasers: new Set<string>(), sameProductRepurchasers: new Set<string>(), sales: 0, gaps: [] };
      if (!row.customers.has(customerId)) { row.customers.add(customerId); row.sales += customerSales; row.gaps.push(...customerGaps); }
      if (laterOrders.length) row.repurchasers.add(customerId);
      if (laterKeys.has(key)) row.sameProductRepurchasers.add(customerId);
      productBreakdowns.set(key, row);
    }
    const nextOrder = laterOrders[0];
    if (nextOrder) for (const firstLine of firstLines) for (const nextLine of linesByOrder.get(nextOrder.id) ?? []) {
      const key = `${firstLine.title}→${nextLine.title}`;
      const journey = journeys.get(key) ?? { from: firstLine.title, to: nextLine.title, customers: new Set<string>() };
      journey.customers.add(customerId); journeys.set(key, journey);
    }
  }
  const rankedCustomers = [...ordersByCustomer.entries()]
    .map(([id, customerOrders]) => ({
      id,
      number_of_orders: customerOrders.length,
      amount_spent: customerOrders.reduce((total, order) => total + convertDatedAmount(money(order.net_product_sales) + money(order.shipping_revenue), order.exchange_rate, store.currency), 0),
      last_order_at: customerOrders.at(-1)?.processed_at ?? null,
    }))
    .sort((left, right) => right.amount_spent - left.amount_spent || left.id.localeCompare(right.id))
    .slice(0, 50);
  const customerProfiles = rankedCustomers.length
    ? await supabase.from("shopify_customers").select("id,display_name").eq("store_id", store.id).in("id", rankedCustomers.map((customer) => customer.id))
    : { data: [] as Array<{ id: string; display_name: string | null }>, error: null };
  if (customerProfiles.error) return NextResponse.json({ error: customerProfiles.error.message }, { status: 500 });
  const profilesById = new Map((customerProfiles.data ?? []).map((customer) => [customer.id, customer.display_name]));

  return NextResponse.json({
    hasData: orders.length > 0,
    currency: store.currency,
    timezone: store.timezone || "UTC",
    period: orders.length ? { start: orders[0].processed_at?.slice(0, 10) ?? null, end: orders.at(-1)?.processed_at?.slice(0, 10) ?? null } : null,
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
    customers: rankedCustomers.map((customer, index) => ({
      ...customer,
      amount_spent: Math.round(customer.amount_spent * 100) / 100,
      currency: store.currency,
      country_code: latestCountryByCustomer.get(customer.id) ?? null,
      display_name: ["owner", "admin", "analyst"].includes(membership.role) ? profilesById.get(customer.id) ?? null : `Customer ${index + 1}`,
    })),
    locations: [...locationTotals.entries()].map(([countryCode, location]) => ({ countryCode, orders: location.orders, customers: location.customers.size, sales: Math.round(location.sales * 100) / 100 })).sort((left, right) => right.orders - left.orders),
    months: [...months.values()].sort((left, right) => left.key.localeCompare(right.key)),
    cohorts,
    behavior: {
      repurchaseWindows,
      averageTimeBetweenOrders: gaps.length ? gaps.reduce((total, value) => total + value, 0) / gaps.length : null,
      timeBetweenOrders,
      productBreakdown: [...productBreakdowns.values()].map((row) => ({ product: row.product, sku: row.sku, customers: row.customers.size, repurchasers: row.repurchasers.size, averageSalesPerCustomer: row.customers.size ? row.sales / row.customers.size : 0, repurchasedAnythingRate: row.customers.size ? row.repurchasers.size / row.customers.size : 0, repurchasedSameProductRate: row.customers.size ? row.sameProductRepurchasers.size / row.customers.size : 0, averageDaysBetweenOrders: row.gaps.length ? row.gaps.reduce((total, value) => total + value, 0) / row.gaps.length : null })).sort((left, right) => right.customers - left.customers).slice(0, 50),
      productJourneys: [...journeys.values()].map((journey) => ({ from: journey.from, to: journey.to, customers: journey.customers.size })).sort((left, right) => right.customers - left.customers).slice(0, 30),
    },
  });
}
