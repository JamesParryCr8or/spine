/**
 * Sales insights from ShopifyQL aggregates: the query text and the shaping of
 * the results. No orders are read or stored. Pure (no I/O) and unit tested;
 * relative imports only so the node test runner can load it.
 */
import { parseNumber, type ShopifyQlRow } from "./campaign-rows.ts";

export type RankRow = { label: string; orders: number; sales: number };
export type TimeBucket = { orders: number; sales: number };
export type MarginRow = { product: string; units: number; sales: number; cogs: number; margin: number; marginPct: number };

export type SalesInsights = {
  summary: { orders: number; netSales: number; units: number; aov: number; unitsPerOrder: number; repeatRate: number | null; discountedShare: number };
  byHour: TimeBucket[];
  byWeekday: TimeBucket[];
  margin: { rows: MarginRow[]; incompleteProducts: number; costedShare: number };
  countries: RankRow[];
  channels: RankRow[];
  discountCodes: Array<RankRow & { discounts: number }>;
  customerTypes: RankRow[];
};

export const salesInsightQueryNames = ["customers", "hours", "weekdays", "products", "countries", "channels", "discounts"] as const;
export type SalesInsightQueryName = (typeof salesInsightQueryNames)[number];
export type SalesInsightResults = Record<SalesInsightQueryName, ShopifyQlRow[]>;

/** One ShopifyQL query per breakdown; dates are inclusive, in the shop's timezone. */
export function salesInsightQueries(from: string, to: string): Record<SalesInsightQueryName, string> {
  const window = `SINCE ${from} UNTIL ${to}`;
  return {
    customers: `FROM sales SHOW orders, net_sales, net_items_sold GROUP BY new_or_returning_customer ${window}`,
    hours: `FROM sales SHOW orders, net_sales GROUP BY hour_of_day ${window}`,
    weekdays: `FROM sales SHOW orders, net_sales GROUP BY day_of_week ${window}`,
    products: `FROM sales SHOW net_items_sold, net_sales, cost_of_goods_sold, gross_profit, net_sales_without_cost_recorded GROUP BY product_title ${window} ORDER BY net_sales DESC LIMIT 200`,
    countries: `FROM sales SHOW orders, net_sales GROUP BY shipping_country ${window} ORDER BY net_sales DESC LIMIT 10`,
    channels: `FROM sales SHOW orders, net_sales GROUP BY sales_channel ${window} ORDER BY net_sales DESC LIMIT 8`,
    discounts: `FROM sales SHOW orders, net_sales, discounts GROUP BY discount_code ${window} ORDER BY net_sales DESC LIMIT 12`,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const count = (value: unknown) => Math.max(0, Math.trunc(parseNumber(value)));

function rank(rows: ShopifyQlRow[], key: string, fallback: string): RankRow[] {
  return rows.map((row) => ({ label: text(row[key]) || fallback, orders: count(row.orders), sales: round2(parseNumber(row.net_sales)) }))
    .filter((row) => row.orders > 0 || row.sales !== 0)
    .sort((left, right) => right.sales - left.sales);
}

export function buildSalesInsights(results: SalesInsightResults): SalesInsights {
  let orders = 0, netSales = 0, units = 0, newOrders = 0, returningOrders = 0;
  const customerTypes = results.customers.flatMap((row): RankRow[] => {
    const type = text(row.new_or_returning_customer).toLowerCase();
    const rowOrders = count(row.orders), sales = parseNumber(row.net_sales);
    if (rowOrders === 0 && sales === 0) return [];
    orders += rowOrders; netSales += sales; units += Math.trunc(parseNumber(row.net_items_sold));
    if (type === "new") newOrders += rowOrders;
    if (type === "returning") returningOrders += rowOrders;
    return [{ label: type === "new" ? "New customer" : type === "returning" ? "Repeat customer" : "Guest / unknown", orders: rowOrders, sales: round2(sales) }];
  }).sort((left, right) => right.sales - left.sales);

  // hour_of_day is 0-23; day_of_week is 0 = Monday (checked against a known date).
  const byHour: TimeBucket[] = Array.from({ length: 24 }, () => ({ orders: 0, sales: 0 }));
  for (const row of results.hours) {
    const hour = Math.trunc(parseNumber(row.hour_of_day));
    if (hour >= 0 && hour < 24) { byHour[hour].orders += count(row.orders); byHour[hour].sales += parseNumber(row.net_sales); }
  }
  const byWeekday: TimeBucket[] = Array.from({ length: 7 }, () => ({ orders: 0, sales: 0 }));
  for (const row of results.weekdays) {
    const day = Math.trunc(parseNumber(row.day_of_week));
    if (day >= 0 && day < 7) { byWeekday[day].orders += count(row.orders); byWeekday[day].sales += parseNumber(row.net_sales); }
  }

  // A product's margin is only ranked when every sale has a recorded cost; a partial figure would flatter it.
  const marginRows: MarginRow[] = [];
  let incompleteProducts = 0, productSales = 0, costedProductSales = 0;
  for (const row of results.products) {
    const product = text(row.product_title);
    const sales = parseNumber(row.net_sales);
    if (!product || sales <= 0) continue;
    const uncosted = Math.max(0, parseNumber(row.net_sales_without_cost_recorded));
    productSales += sales; costedProductSales += Math.max(0, sales - uncosted);
    if (uncosted > 0.005) { incompleteProducts += 1; continue; }
    const margin = parseNumber(row.gross_profit);
    marginRows.push({ product, units: Math.trunc(parseNumber(row.net_items_sold)), sales: round2(sales), cogs: round2(parseNumber(row.cost_of_goods_sold)), margin: round2(margin), marginPct: margin / sales });
  }
  marginRows.sort((left, right) => right.margin - left.margin);

  const discountCodes = results.discounts.map((row) => ({ label: text(row.discount_code) || "No discount code", orders: count(row.orders), sales: round2(parseNumber(row.net_sales)), discounts: round2(Math.abs(parseNumber(row.discounts))) }))
    .filter((row) => row.orders > 0 || row.sales !== 0)
    .sort((left, right) => right.sales - left.sales);
  // An order with several codes counts once per code here, so the share is capped at 100%.
  const discountedOrders = discountCodes.filter((row) => row.label !== "No discount code").reduce((total, row) => total + row.orders, 0);

  const known = newOrders + returningOrders;
  return {
    summary: {
      orders, netSales: round2(netSales), units,
      aov: orders ? netSales / orders : 0,
      unitsPerOrder: orders ? units / orders : 0,
      repeatRate: known ? returningOrders / known : null,
      discountedShare: orders ? Math.min(1, discountedOrders / orders) : 0,
    },
    byHour: byHour.map((bucket) => ({ orders: bucket.orders, sales: round2(bucket.sales) })),
    byWeekday: byWeekday.map((bucket) => ({ orders: bucket.orders, sales: round2(bucket.sales) })),
    margin: { rows: marginRows.slice(0, 100), incompleteProducts, costedShare: productSales > 0 ? costedProductSales / productSales : 0 },
    countries: rank(results.countries, "shipping_country", "Unknown"),
    channels: rank(results.channels, "sales_channel", "Unknown"),
    discountCodes,
    customerTypes,
  };
}
