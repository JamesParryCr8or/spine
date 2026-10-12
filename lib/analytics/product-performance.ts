/**
 * Product performance from ShopifyQL aggregates: sales, refunds and Shopify's
 * recorded cost and gross profit per product and variant, plus a monthly trend.
 * No ad spend, shipping or fee allocation: none of those can be attributed to a
 * single product from Shopify's data. Pure and unit tested; relative imports only.
 */
import { parseNumber, type ShopifyQlRow } from "./campaign-rows.ts";

export type VariantRow = { variant: string; units: number; grossSales: number; discounts: number; refunds: number; netSales: number; cogs: number | null; grossProfit: number | null; marginPct: number | null };
export type ProductRow = Omit<VariantRow, "variant"> & { product: string; orders: number; variants: VariantRow[]; costCoverage: number };
export type TrendPoint = { month: string; units: number; netSales: number };

export type ProductPerformance = {
  products: ProductRow[];
  trend: Record<string, TrendPoint[]>;
  trendTruncated: boolean;
  totals: { products: number; units: number; grossSales: number; refunds: number; netSales: number; grossProfit: number | null; marginPct: number | null; costedShare: number };
};

export const productQueryNames = ["products", "variants", "trend"] as const;
export type ProductQueryName = (typeof productQueryNames)[number];
export type ProductResults = Record<ProductQueryName, ShopifyQlRow[]>;
export const trendRowCap = 1000;

const measures = "net_items_sold, gross_sales, discounts, sales_reversals, net_sales, cost_of_goods_sold, gross_profit, net_sales_without_cost_recorded";

/** `trendFrom` is the first day of the month the trend starts in (at most 12 months back from `to`). */
export function productQueries(from: string, to: string, trendFrom: string): Record<ProductQueryName, string> {
  const window = `SINCE ${from} UNTIL ${to}`;
  return {
    products: `FROM sales SHOW orders, ${measures} GROUP BY product_title ${window} ORDER BY net_sales DESC LIMIT 500`,
    variants: `FROM sales SHOW ${measures} GROUP BY product_title, product_variant_title ${window} ORDER BY net_sales DESC LIMIT 1000`,
    trend: `FROM sales SHOW net_items_sold, net_sales GROUP BY product_title TIMESERIES month SINCE ${trendFrom} UNTIL ${to} ORDER BY month ASC LIMIT ${trendRowCap}`,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Cost and margin are only reported when every sale has a recorded cost: a partial figure would flatter the product. */
function financials(row: ShopifyQlRow) {
  const netSales = parseNumber(row.net_sales);
  const uncosted = Math.max(0, parseNumber(row.net_sales_without_cost_recorded));
  const complete = netSales > 0 && uncosted <= 0.005;
  const grossProfit = complete ? parseNumber(row.gross_profit) : null;
  return { uncosted, numbers: {
    units: Math.trunc(parseNumber(row.net_items_sold)),
    grossSales: round2(parseNumber(row.gross_sales)),
    discounts: round2(Math.abs(parseNumber(row.discounts))),
    refunds: round2(Math.abs(parseNumber(row.sales_reversals))),
    netSales: round2(netSales),
    cogs: complete ? round2(parseNumber(row.cost_of_goods_sold)) : null,
    grossProfit: grossProfit === null ? null : round2(grossProfit),
    marginPct: grossProfit === null ? null : grossProfit / netSales,
  } };
}

export function buildProductPerformance(results: ProductResults): ProductPerformance {
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const row of results.variants) {
    const product = text(row.product_title);
    const { numbers } = financials(row);
    if (!product || (numbers.units === 0 && numbers.netSales === 0)) continue;
    const list = variantsByProduct.get(product) ?? [];
    list.push({ variant: text(row.product_variant_title) || "Default", ...numbers });
    variantsByProduct.set(product, list);
  }

  const products: ProductRow[] = [];
  let costedSales = 0, totalNet = 0;
  for (const row of results.products) {
    const product = text(row.product_title);
    const { uncosted, numbers } = financials(row);
    if (!product || (numbers.units === 0 && numbers.netSales === 0)) continue;
    totalNet += Math.max(numbers.netSales, 0);
    costedSales += Math.max(0, numbers.netSales - uncosted);
    products.push({ product, orders: Math.trunc(parseNumber(row.orders)), ...numbers, variants: (variantsByProduct.get(product) ?? []).sort((left, right) => right.netSales - left.netSales), costCoverage: numbers.netSales > 0 ? Math.max(0, 1 - uncosted / numbers.netSales) : 1 });
  }
  products.sort((left, right) => right.netSales - left.netSales);

  const trend: Record<string, TrendPoint[]> = {};
  for (const row of results.trend) {
    const product = text(row.product_title);
    const month = typeof row.month === "string" ? row.month.slice(0, 7) : "";
    const units = Math.trunc(parseNumber(row.net_items_sold)), netSales = round2(parseNumber(row.net_sales));
    if (!product || !month || (units === 0 && netSales === 0)) continue;
    (trend[product] ??= []).push({ month, units, netSales });
  }
  for (const points of Object.values(trend)) points.sort((left, right) => left.month.localeCompare(right.month));

  const complete = products.filter((product) => product.grossProfit !== null);
  const completeNet = complete.reduce((total, product) => total + product.netSales, 0);
  const grossProfit = complete.length ? round2(complete.reduce((total, product) => total + (product.grossProfit ?? 0), 0)) : null;
  return {
    products, trend, trendTruncated: results.trend.length >= trendRowCap,
    totals: {
      products: products.length,
      units: products.reduce((total, product) => total + product.units, 0),
      grossSales: round2(products.reduce((total, product) => total + product.grossSales, 0)),
      refunds: round2(products.reduce((total, product) => total + product.refunds, 0)),
      netSales: round2(products.reduce((total, product) => total + product.netSales, 0)),
      grossProfit,
      marginPct: grossProfit !== null && completeNet > 0 ? grossProfit / completeNet : null,
      costedShare: totalNet > 0 ? costedSales / totalNet : 0,
    },
  };
}
