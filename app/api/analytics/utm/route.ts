import { NextResponse } from "next/server";

import { monetary } from "@/lib/analytics/effective-cost";
import { reportingRangeToUtc } from "@/lib/analytics/reporting-range";
import { normalizeAttribution } from "@/lib/analytics/utm-attribution";
import { createClient } from "@/lib/supabase/server";
import { createCurrencyCoverage } from "@/lib/analytics/currency-coverage";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";

type Order = { id: string; customer_id: string | null; net_product_sales: string; processed_at: string | null; currency: string; country_code: string | null; exchange_rate: number };
type Attribution = { order_id: string; source: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; landing_page: string | null; referrer_url: string | null; customer_order_index: number | null };
type Diagnostic = { orders: number; sales: number };

const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
const cleanLandingPage = (value: string | null) => value?.trim() || "Unknown";
const monthKey = (value: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(value));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const attributionModel = params.get("attribution") === "first_touch" ? "first_touch" : "last_touch";
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";
  const countryFilter = params.get("country")?.trim().toUpperCase() ?? "";
  const productFilter = params.get("product")?.trim() ?? "";
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if ((fromDate && !isDate(fromDate)) || (toDate && !isDate(toDate)) || (fromDate && toDate && fromDate > toDate)) return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id,currency,timezone").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { data: exchangeRateRows, error: exchangeRateError } = await supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true });
  if (exchangeRateError) return NextResponse.json({ error: exchangeRateError.message }, { status: 500 });
  const exchangeRates = (exchangeRateRows ?? []) as DatedExchangeRate[];
  const pageSize = 1000;
  const orderRows: Order[] = [];
  const currencyCoverage = createCurrencyCoverage(store.currency);
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from("shopify_orders").select("id,customer_id,net_product_sales,processed_at,currency,country_code").eq("store_id", store.id).is("cancelled_at", null).eq("test", false).not("processed_at", "is", null);
    if (fromDate) query = query.gte("processed_at", reportingRangeToUtc(fromDate, fromDate, store.timezone || "UTC").start);
    if (toDate) query = query.lt("processed_at", reportingRangeToUtc(toDate, toDate, store.timezone || "UTC").endExclusive);
    const { data, error } = await query.order("processed_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as Array<Omit<Order, "exchange_rate">>;
    for (const order of page) {
      const exchangeRate = resolveDatedExchangeRate(exchangeRates, order.currency, store.currency, order.processed_at ?? "");
      if (currencyCoverage.include(order.currency, exchangeRate)) orderRows.push({ ...order, exchange_rate: exchangeRate ?? 1 });
    }
    if (page.length < pageSize) break;
  }

  const orderProducts = new Map<string, Set<string>>();
  for (const ids of chunks(orderRows.map((order) => order.id), 500)) {
    const { data, error } = await supabase.from("shopify_order_lines").select("order_id,title,variant_title").in("order_id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const line of data ?? []) {
      const label = line.variant_title ? `${line.title} · ${line.variant_title}` : line.title;
      const products = orderProducts.get(line.order_id) ?? new Set<string>();
      products.add(label); orderProducts.set(line.order_id, products);
    }
  }
  const filterOptions = {
    countries: [...new Set(orderRows.map((order) => order.country_code).filter((value): value is string => Boolean(value)))].sort(),
    products: [...new Set([...orderProducts.values()].flatMap((products) => [...products]))].sort(),
  };
  const filteredOrderRows = orderRows.filter((order) => (!countryFilter || order.country_code === countryFilter) && (!productFilter || orderProducts.get(order.id)?.has(productFilter)));

  const attributions: Attribution[] = [];
  for (const ids of chunks(filteredOrderRows.map((order) => order.id), 500)) {
    const { data, error } = await supabase.from("shopify_order_attribution").select("order_id,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,referrer_url,customer_order_index").eq("attribution_model", attributionModel).in("order_id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    attributions.push(...((data ?? []) as Attribution[]));
  }
  const attributionByOrder = new Map(attributions.map((attribution) => [attribution.order_id, attribution]));
  const groups = new Map<string, { channel: string; source: string; medium: string; campaign: string; content: string; term: string; landingPage: string; customerType: string; sales: number; orders: number; newCustomerSales: number; customerIds: Set<string> }>();
  const trends = new Map<string, { period: string; sales: number; orders: number; newCustomerSales: number; customerIds: Set<string> }>();
  const diagnostics: Record<"missingAttribution" | "missingUtm" | "missingLandingPage" | "missingReferrer", Diagnostic> = {
    missingAttribution: { orders: 0, sales: 0 }, missingUtm: { orders: 0, sales: 0 }, missingLandingPage: { orders: 0, sales: 0 }, missingReferrer: { orders: 0, sales: 0 },
  };

  for (const order of filteredOrderRows) {
    if (!order.processed_at) continue;
    const attribution = attributionByOrder.get(order.id) ?? null;
    const normalized = normalizeAttribution(attribution ? { source: attribution.source, utmSource: attribution.utm_source, utmMedium: attribution.utm_medium, utmCampaign: attribution.utm_campaign, utmContent: attribution.utm_content, utmTerm: attribution.utm_term, referrerUrl: attribution.referrer_url } : null);
    const sales = convertDatedAmount(monetary(order.net_product_sales), order.exchange_rate, store.currency);
    const customerType = !order.customer_id ? "Guest" : attribution?.customer_order_index === 1 ? "New" : "Repeat";
    const landingPage = cleanLandingPage(attribution?.landing_page ?? null);
    const key = [normalized.channel, normalized.source, normalized.medium, normalized.campaign, normalized.content, normalized.term, landingPage, customerType].join("\u0000");
    const group = groups.get(key) ?? { ...normalized, landingPage, customerType, sales: 0, orders: 0, newCustomerSales: 0, customerIds: new Set<string>() };
    group.sales += sales;
    group.orders += 1;
    if (customerType === "New") group.newCustomerSales += sales;
    if (order.customer_id) group.customerIds.add(order.customer_id);
    groups.set(key, group);

    const period = monthKey(order.processed_at, store.timezone || "UTC");
    const trend = trends.get(period) ?? { period, sales: 0, orders: 0, newCustomerSales: 0, customerIds: new Set<string>() };
    trend.sales += sales;
    trend.orders += 1;
    if (customerType === "New") trend.newCustomerSales += sales;
    if (order.customer_id) trend.customerIds.add(order.customer_id);
    trends.set(period, trend);

    if (!attribution) { diagnostics.missingAttribution.orders += 1; diagnostics.missingAttribution.sales += sales; continue; }
    if (!attribution.utm_source?.trim() && !attribution.utm_medium?.trim() && !attribution.utm_campaign?.trim()) { diagnostics.missingUtm.orders += 1; diagnostics.missingUtm.sales += sales; }
    if (!attribution.landing_page?.trim()) { diagnostics.missingLandingPage.orders += 1; diagnostics.missingLandingPage.sales += sales; }
    if (!attribution.referrer_url?.trim()) { diagnostics.missingReferrer.orders += 1; diagnostics.missingReferrer.sales += sales; }
  }

  const rows = [...groups.values()].map(({ customerIds, ...group }) => ({ ...group, customers: customerIds.size, revenuePerCustomer: customerIds.size ? group.sales / customerIds.size : null, averageOrderValue: group.orders ? group.sales / group.orders : 0 })).sort((left, right) => right.sales - left.sales);
  const identifiedCustomers = new Set(filteredOrderRows.flatMap((order) => order.customer_id ? [order.customer_id] : []));
  const totals = rows.reduce((total, group) => ({ sales: total.sales + group.sales, orders: total.orders + group.orders, newCustomerSales: total.newCustomerSales + group.newCustomerSales }), { sales: 0, orders: 0, newCustomerSales: 0 });
  return NextResponse.json({
    hasData: filteredOrderRows.length > 0,
    currency: store.currency,
    timezone: store.timezone || "UTC",
    currencyCoverage: currencyCoverage.summary(),
    attributionModel,
    filterOptions,
    period: filteredOrderRows.length ? { start: filteredOrderRows[0].processed_at?.slice(0, 10), end: filteredOrderRows.at(-1)?.processed_at?.slice(0, 10) } : null,
    totals: { ...totals, attributedOrders: filteredOrderRows.length - diagnostics.missingAttribution.orders, customers: identifiedCustomers.size, averageOrderValue: totals.orders ? totals.sales / totals.orders : 0, revenuePerCustomer: identifiedCustomers.size ? totals.sales / identifiedCustomers.size : null },
    diagnostics,
    trends: [...trends.values()].sort((left, right) => left.period.localeCompare(right.period)).map(({ customerIds, ...trend }) => ({ ...trend, customers: customerIds.size })),
    rows,
  });
}
