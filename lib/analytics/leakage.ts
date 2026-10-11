/**
 * Profit-leakage reports from ShopifyQL aggregates: refunds by product,
 * discount codes, shipping by country and processing fees over time. Pure
 * (no I/O) and unit tested; relative imports only.
 */
import { parseNumber, type ShopifyQlRow } from "./campaign-rows.ts";

export type PostageDefaults = { postageAmount: number; postageBasis: "orders" | "units"; fulfilmentAmount: number; fulfilmentBasis: "orders" | "units" };

export type RefundRow = { product: string; refunded: number; grossSales: number; rate: number; units: number };
export type DiscountRow = { code: string; orders: number; netSales: number; discounts: number; discountRate: number; grossProfit: number | null; marginPct: number | null };
export type ShippingRow = { country: string; orders: number; charged: number; estimatedCost: number | null; result: number | null };
export type FeeMonth = { month: string; fees: number; sales: number; rate: number | null };

export type Leakage = {
  refunds: RefundRow[];
  discounts: { rows: DiscountRow[]; baselineMarginPct: number | null };
  shipping: { rows: ShippingRow[]; hasEstimate: boolean };
  fees: FeeMonth[];
};

export const leakageQueryNames = ["refunds", "discounts", "shipping", "fees", "salesMonthly"] as const;
export type LeakageQueryName = (typeof leakageQueryNames)[number];
export type LeakageResults = Record<LeakageQueryName, ShopifyQlRow[]>;

export function leakageQueries(from: string, to: string): Record<LeakageQueryName, string> {
  const window = `SINCE ${from} UNTIL ${to}`;
  return {
    refunds: `FROM sales SHOW gross_sales, sales_reversals, net_items_sold GROUP BY product_title ${window} ORDER BY sales_reversals ASC LIMIT 15`,
    discounts: `FROM sales SHOW orders, net_sales, discounts, gross_profit, net_sales_without_cost_recorded GROUP BY discount_code ${window} ORDER BY net_sales DESC LIMIT 15`,
    shipping: `FROM sales SHOW orders, net_items_sold, shipping_charges GROUP BY shipping_country ${window} ORDER BY orders DESC LIMIT 12`,
    fees: `FROM fees SHOW shopify_payments_processing_fees, foreign_exchange_fees, international_fees TIMESERIES month ${window} ORDER BY month ASC`,
    salesMonthly: `FROM sales SHOW total_sales TIMESERIES month ${window} ORDER BY month ASC`,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const count = (value: unknown) => Math.max(0, Math.trunc(parseNumber(value)));
const monthKey = (value: unknown) => (typeof value === "string" ? value.slice(0, 7) : "");

export function buildLeakage(results: LeakageResults, defaults: PostageDefaults | null): Leakage {
  const refunds = results.refunds.flatMap((row): RefundRow[] => {
    const product = text(row.product_title);
    const refunded = Math.abs(parseNumber(row.sales_reversals)), grossSales = parseNumber(row.gross_sales);
    if (!product || refunded <= 0) return [];
    return [{ product, refunded: round2(refunded), grossSales: round2(grossSales), rate: grossSales > 0 ? refunded / grossSales : 0, units: Math.trunc(parseNumber(row.net_items_sold)) }];
  }).sort((left, right) => right.refunded - left.refunded).slice(0, 10);

  // Orders without a code are the baseline; codes whose sales lack a recorded cost have no margin (a partial figure would flatter them).
  let baselineMarginPct: number | null = null;
  const discountRows: DiscountRow[] = [];
  for (const row of results.discounts) {
    const code = text(row.discount_code);
    const orders = count(row.orders), netSales = parseNumber(row.net_sales), discounts = Math.abs(parseNumber(row.discounts));
    if (orders === 0 && netSales === 0 && discounts === 0) continue;
    const costComplete = parseNumber(row.net_sales_without_cost_recorded) <= 0.005 && netSales > 0;
    const grossProfit = costComplete ? parseNumber(row.gross_profit) : null;
    const marginPct = grossProfit !== null && netSales > 0 ? grossProfit / netSales : null;
    if (!code) { baselineMarginPct = marginPct; continue; }
    discountRows.push({ code, orders, netSales: round2(netSales), discounts: round2(discounts), discountRate: netSales + discounts > 0 ? discounts / (netSales + discounts) : 0, grossProfit: grossProfit === null ? null : round2(grossProfit), marginPct });
  }
  discountRows.sort((left, right) => right.discounts - left.discounts);

  // Merchant shipping cost is not in Shopify; it is estimated from the store's default postage and fulfilment rates.
  const shippingRows = results.shipping.flatMap((row): ShippingRow[] => {
    const orders = count(row.orders), units = Math.max(0, Math.trunc(parseNumber(row.net_items_sold))), charged = parseNumber(row.shipping_charges);
    if (orders === 0 && charged === 0) return [];
    const estimatedCost = defaults ? (defaults.postageBasis === "units" ? units : orders) * defaults.postageAmount + (defaults.fulfilmentBasis === "units" ? units : orders) * defaults.fulfilmentAmount : null;
    return [{ country: text(row.shipping_country) || "Unknown", orders, charged: round2(charged), estimatedCost: estimatedCost === null ? null : round2(estimatedCost), result: estimatedCost === null ? null : round2(charged - estimatedCost) }];
  });
  if (defaults) shippingRows.sort((left, right) => (left.result ?? 0) - (right.result ?? 0));

  const salesByMonth = new Map(results.salesMonthly.map((row) => [monthKey(row.month), parseNumber(row.total_sales)]));
  const fees = results.fees.flatMap((row): FeeMonth[] => {
    const month = monthKey(row.month);
    if (!month) return [];
    const total = parseNumber(row.shopify_payments_processing_fees) + parseNumber(row.foreign_exchange_fees) + parseNumber(row.international_fees);
    const sales = salesByMonth.get(month) ?? 0;
    return [{ month, fees: round2(total), sales: round2(sales), rate: sales > 0 ? total / sales : null }];
  });

  return { refunds, discounts: { rows: discountRows, baselineMarginPct }, shipping: { rows: shippingRows, hasEstimate: Boolean(defaults) }, fees };
}
