/**
 * Sales insights: patterns a Shopify admin doesn't show. Pure functions over
 * already-loaded rows (the route does the I/O), so they are unit tested.
 * Imports are relative so the node test runner can load this file.
 */

export type InsightOrder = {
  id: string;
  customerId: string | null;
  processedAt: string;
  source: string | null;
  country: string | null;
  discountCodes: string[];
  /** Product sales net of discounts and refunds. */
  netSales: number;
  discounts: number;
  /** 1 = the customer's first order, >1 = repeat, null = unknown. */
  customerIndex: number | null;
  /** Storefront (Shopify Markets) domain the customer landed on, or null when no visit was tracked. */
  storeDomain: string | null;
};

export type InsightLine = {
  orderId: string;
  productKey: string;
  product: string;
  units: number;
  netSales: number;
  /** Effective unit cost, or null when no cost is known for this line. */
  unitCost: number | null;
};

export type RankRow = { label: string; orders: number; sales: number };
export type ComboRow = { a: string; b: string; orders: number; netSales: number; /** Share of orders containing the rarer product that also contain the other. */ confidence: number };
export type TimeBucket = { orders: number; sales: number };
export type DomainRow = { domain: string; orders: number; sales: number; aov: number };
export type MarginRow = { product: string; units: number; sales: number; cogs: number; margin: number; marginPct: number };

export type SalesInsights = {
  summary: { orders: number; netSales: number; units: number; aov: number; unitsPerOrder: number; repeatRate: number | null; discountedShare: number; multiProductShare: number };
  combos: ComboRow[];
  byHour: TimeBucket[];
  byWeekday: TimeBucket[];
  domains: { rows: DomainRow[]; /** Share of orders with a known storefront domain. */ coverage: number };
  margin: { rows: MarginRow[]; incompleteProducts: number; costedShare: number };
  countries: RankRow[];
  channels: RankRow[];
  discountCodes: Array<RankRow & { discounts: number }>;
  customerTypes: RankRow[];
};

/** Storefront host of a landing-page URL ("www." stripped), or null if it has no host. */
export function storeDomainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const topBy = <T,>(items: T[], score: (item: T) => number, limit: number) => items.sort((left, right) => score(right) - score(left)).slice(0, limit);

/** Hour (0-23) and weekday (0 = Monday) of an instant in a timezone. */
export function localTimeParts(formatter: Intl.DateTimeFormat, iso: string) {
  const parts = formatter.formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
  return { hour, weekday };
}

function rank(map: Map<string, { orders: Set<string>; sales: number }>, limit: number): RankRow[] {
  return topBy([...map].map(([label, row]) => ({ label, orders: row.orders.size, sales: round2(row.sales) })), (row) => row.sales, limit);
}

function add(map: Map<string, { orders: Set<string>; sales: number }>, label: string, orderId: string, sales: number) {
  const row = map.get(label) ?? { orders: new Set<string>(), sales: 0 };
  row.orders.add(orderId);
  row.sales += sales;
  map.set(label, row);
}

export function computeSalesInsights(orders: InsightOrder[], lines: InsightLine[], timezone: string): SalesInsights {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23", weekday: "short" });
  const byHour: TimeBucket[] = Array.from({ length: 24 }, () => ({ orders: 0, sales: 0 }));
  const byWeekday: TimeBucket[] = Array.from({ length: 7 }, () => ({ orders: 0, sales: 0 }));
  const countries = new Map<string, { orders: Set<string>; sales: number }>();
  const channels = new Map<string, { orders: Set<string>; sales: number }>();
  const customerTypes = new Map<string, { orders: Set<string>; sales: number }>();
  const codes = new Map<string, { orders: Set<string>; sales: number; discounts: number }>();
  const domains = new Map<string, { orders: number; sales: number }>();
  let withDomain = 0;
  let netSales = 0, discounted = 0, known = 0, repeat = 0;

  for (const order of orders) {
    netSales += order.netSales;
    if (order.discounts > 0 || order.discountCodes.length) discounted += 1;
    if (order.customerIndex !== null) { known += 1; if (order.customerIndex > 1) repeat += 1; }
    const { hour, weekday } = localTimeParts(formatter, order.processedAt);
    byHour[hour].orders += 1; byHour[hour].sales += order.netSales;
    if (weekday >= 0) { byWeekday[weekday].orders += 1; byWeekday[weekday].sales += order.netSales; }
    add(countries, order.country || "Unknown", order.id, order.netSales);
    add(channels, order.source || "Unknown", order.id, order.netSales);
    add(customerTypes, !order.customerId ? "Guest" : order.customerIndex === 1 ? "New customer" : order.customerIndex && order.customerIndex > 1 ? "Repeat customer" : "Known customer", order.id, order.netSales);
    const orderCodes = order.discountCodes.length ? order.discountCodes : ["No discount code"];
    for (const code of orderCodes) {
      const row = codes.get(code) ?? { orders: new Set<string>(), sales: 0, discounts: 0 };
      row.orders.add(order.id);
      row.sales += order.netSales / orderCodes.length;
      row.discounts += order.discounts / orderCodes.length;
      codes.set(code, row);
    }
    if (order.storeDomain) {
      withDomain += 1;
      const row = domains.get(order.storeDomain) ?? { orders: 0, sales: 0 };
      row.orders += 1;
      row.sales += order.netSales;
      domains.set(order.storeDomain, row);
    }
  }

  // Lines grouped by order once, for combos and margin.
  const linesByOrder = new Map<string, InsightLine[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId);
    if (list) list.push(line); else linesByOrder.set(line.orderId, [line]);
  }
  const orderIds = new Set(orders.map((order) => order.id));
  let units = 0, multiProductOrders = 0;
  const productOrders = new Map<string, number>();
  const pairs = new Map<string, { a: string; b: string; orders: number; netSales: number }>();
  const margin = new Map<string, { product: string; units: number; sales: number; cogs: number; costedSales: number }>();
  let costedSales = 0, totalLineSales = 0;

  for (const [orderId, orderLines] of linesByOrder) {
    if (!orderIds.has(orderId)) continue;
    const distinct = new Map<string, { product: string; sales: number }>();
    for (const line of orderLines) {
      units += line.units;
      const entry = distinct.get(line.productKey) ?? { product: line.product, sales: 0 };
      entry.sales += line.netSales;
      distinct.set(line.productKey, entry);

      const row = margin.get(line.productKey) ?? { product: line.product, units: 0, sales: 0, cogs: 0, costedSales: 0 };
      row.units += line.units; row.sales += line.netSales;
      if (line.unitCost !== null) { row.cogs += line.unitCost * line.units; row.costedSales += line.netSales; costedSales += line.netSales; }
      totalLineSales += line.netSales;
      margin.set(line.productKey, row);
    }
    for (const key of distinct.keys()) productOrders.set(key, (productOrders.get(key) ?? 0) + 1);
    if (distinct.size > 1) {
      multiProductOrders += 1;
      // Cap per-order products so a 60-line wholesale order can't dominate the pair count.
      const keys = [...distinct].sort((left, right) => right[1].sales - left[1].sales).slice(0, 12);
      for (let i = 0; i < keys.length; i += 1) for (let j = i + 1; j < keys.length; j += 1) {
        const [left, right] = keys[i][0] < keys[j][0] ? [keys[i], keys[j]] : [keys[j], keys[i]];
        const id = `${left[0]}|${right[0]}`;
        const pair = pairs.get(id) ?? { a: left[1].product, b: right[1].product, orders: 0, netSales: 0 };
        pair.orders += 1; pair.netSales += keys[i][1].sales + keys[j][1].sales;
        pairs.set(id, pair);
      }
    }
  }

  const keyOf = new Map<string, string>();
  for (const [key, row] of margin) keyOf.set(row.product, key);
  const combos = topBy([...pairs.values()].filter((pair) => pair.orders >= 2).map((pair) => {
    const rarer = Math.min(productOrders.get(keyOf.get(pair.a) ?? "") ?? pair.orders, productOrders.get(keyOf.get(pair.b) ?? "") ?? pair.orders);
    return { a: pair.a, b: pair.b, orders: pair.orders, netSales: round2(pair.netSales), confidence: rarer ? pair.orders / rarer : 0 };
  }), (pair) => pair.orders, 12);

  // A product's margin is only ranked when every unit sold has a known cost; a partial figure would flatter it.
  const marginRows: MarginRow[] = [];
  let incompleteProducts = 0;
  for (const row of margin.values()) {
    if (row.sales <= 0) continue;
    if (row.costedSales < row.sales - 0.005) { incompleteProducts += 1; continue; }
    marginRows.push({ product: row.product, units: row.units, sales: round2(row.sales), cogs: round2(row.cogs), margin: round2(row.sales - row.cogs), marginPct: (row.sales - row.cogs) / row.sales });
  }

  const domainRows = topBy([...domains].map(([domain, row]) => ({ domain, orders: row.orders, sales: round2(row.sales), aov: row.orders ? row.sales / row.orders : 0 })), (row) => row.sales, 20);
  const discountRows = topBy([...codes].map(([label, row]) => ({ label, orders: row.orders.size, sales: round2(row.sales), discounts: round2(row.discounts) })), (row) => row.sales, 12);

  return {
    summary: {
      orders: orders.length,
      netSales: round2(netSales),
      units,
      aov: orders.length ? netSales / orders.length : 0,
      unitsPerOrder: orders.length ? units / orders.length : 0,
      repeatRate: known ? repeat / known : null,
      discountedShare: orders.length ? discounted / orders.length : 0,
      multiProductShare: orders.length ? multiProductOrders / orders.length : 0,
    },
    combos,
    byHour: byHour.map((bucket) => ({ orders: bucket.orders, sales: round2(bucket.sales) })),
    byWeekday: byWeekday.map((bucket) => ({ orders: bucket.orders, sales: round2(bucket.sales) })),
    domains: { rows: domainRows, coverage: orders.length ? withDomain / orders.length : 0 },
    margin: { rows: topBy(marginRows, (row) => row.margin, 100), incompleteProducts, costedShare: totalLineSales > 0 ? costedSales / totalLineSales : 0 },
    countries: rank(countries, 10),
    channels: rank(channels, 8),
    discountCodes: discountRows,
    customerTypes: rank(customerTypes, 5),
  };
}
