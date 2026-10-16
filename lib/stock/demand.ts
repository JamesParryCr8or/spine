import type { StockDemand } from "./planning.ts";

export const demandWindows = [30, 60, 90] as const;
export const demandPageSize = 1000;
type Row = Record<string, string | number | null>;
export function stockDemandDates(timezone: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  return { through: shift(1), from: { 30: shift(30), 60: shift(60), 90: shift(90) } };
}
export function stockDemandQuery(from: string, through: string, offset: number) {
  return `FROM sales SHOW quantity_ordered, reversed_quantity, net_items_sold GROUP BY product_variant_id SINCE ${from} UNTIL ${through} ORDER BY product_variant_id ASC LIMIT ${demandPageSize} OFFSET ${offset}`;
}
export function buildStockDemand(results: Record<30 | 60 | 90, Row[]>): StockDemand[] {
  const variants = new Map<string, StockDemand>();
  const number = (value: string | number | null | undefined) => {
    const parsed = Number(typeof value === "string" ? value.replaceAll(",", "") : value ?? 0);
    if (!Number.isFinite(parsed)) throw new Error("Shopify returned an invalid demand quantity.");
    return parsed;
  };
  for (const days of demandWindows) {
    const seen = new Set<string>();
    for (const row of results[days]) {
      if (row.product_variant_id === null || row.product_variant_id === undefined) continue;
      const raw = String(row.product_variant_id);
      const variantId = /^\d+$/.test(raw) ? `gid://shopify/ProductVariant/${raw}` : raw;
      if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)) throw new Error("Shopify returned an unrecognised variant ID.");
      if (seen.has(variantId)) throw new Error("Shopify repeated a demand page. Refresh to retry.");
      seen.add(variantId);
      const demand = variants.get(variantId) ?? { variantId, sales30: 0, sales60: 0, sales90: 0, returns30: 0, returns60: 0, returns90: 0, net30: 0, net60: 0, net90: 0 };
      demand[`sales${days}`] = number(row.quantity_ordered);
      demand[`returns${days}`] = Math.abs(number(row.reversed_quantity));
      demand[`net${days}`] = number(row.net_items_sold);
      variants.set(variantId, demand);
    }
  }
  return [...variants.values()];
}
