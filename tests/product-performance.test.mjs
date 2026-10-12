import assert from "node:assert/strict";
import test from "node:test";

import { buildProductPerformance, productQueries, trendRowCap } from "../lib/analytics/product-performance.ts";

const empty = { products: [], variants: [], trend: [] };
const productRow = (title, extra = {}) => ({ product_title: title, orders: "10", net_items_sold: "12", gross_sales: "1200", discounts: "-100", sales_reversals: "-60", net_sales: "1040", cost_of_goods_sold: "400", gross_profit: "640", net_sales_without_cost_recorded: "0", ...extra });

test("queries are ShopifyQL aggregates, with the trend limited to a month window", () => {
  const queries = productQueries("2026-01-01", "2026-06-30", "2025-07-01");
  assert.match(queries.products, /GROUP BY product_title SINCE 2026-01-01 UNTIL 2026-06-30/);
  assert.match(queries.variants, /GROUP BY product_title, product_variant_title/);
  assert.match(queries.trend, /TIMESERIES month SINCE 2025-07-01 UNTIL 2026-06-30/);
  assert.match(queries.trend, new RegExp(`LIMIT ${trendRowCap}`));
});

test("product rows carry sales, refunds and Shopify's gross profit and margin", () => {
  const { products, totals } = buildProductPerformance({ ...empty, products: [productRow("A")] });
  assert.equal(products[0].netSales, 1040);
  assert.equal(products[0].refunds, 60);
  assert.equal(products[0].discounts, 100);
  assert.equal(products[0].grossProfit, 640);
  assert.equal(products[0].marginPct, 640 / 1040);
  assert.equal(totals.grossProfit, 640);
  assert.equal(totals.costedShare, 1);
});

test("a product with any sale missing a cost shows no cost, profit or margin", () => {
  const { products, totals } = buildProductPerformance({ ...empty, products: [
    productRow("Costed"),
    productRow("Partial", { net_sales: "500", cost_of_goods_sold: "100", gross_profit: "300", net_sales_without_cost_recorded: "100" }),
  ] });
  const partial = products.find((row) => row.product === "Partial");
  assert.equal(partial.cogs, null);
  assert.equal(partial.grossProfit, null);
  assert.equal(partial.marginPct, null);
  assert.equal(partial.costCoverage, 0.8);
  assert.equal(totals.grossProfit, 640); // only the fully costed product
  assert.equal(totals.netSales, 1540); // sales still count in full
  assert.equal(totals.costedShare, (1040 + 400) / 1540);
});

test("variants attach to their product, biggest first, and blank titles are skipped", () => {
  const { products } = buildProductPerformance({ ...empty,
    products: [productRow("A"), productRow("", { net_sales: "5" })],
    variants: [
      { product_title: "A", product_variant_title: "Small", net_items_sold: "2", gross_sales: "100", discounts: "0", sales_reversals: "0", net_sales: "100", cost_of_goods_sold: "40", gross_profit: "60", net_sales_without_cost_recorded: "0" },
      { product_title: "A", product_variant_title: "Large", net_items_sold: "5", gross_sales: "500", discounts: "0", sales_reversals: "0", net_sales: "500", cost_of_goods_sold: "", gross_profit: "", net_sales_without_cost_recorded: "500" },
    ] });
  assert.equal(products.length, 1);
  assert.deepEqual(products[0].variants.map((variant) => variant.variant), ["Large", "Small"]);
  assert.equal(products[0].variants[0].grossProfit, null);
});

test("the trend groups months by product in order and flags a truncated result", () => {
  const rows = [
    { month: "2026-02-01", product_title: "A", net_items_sold: "3", net_sales: "30" },
    { month: "2026-01-01", product_title: "A", net_items_sold: "1", net_sales: "10" },
    { month: "2026-01-01", product_title: "", net_items_sold: "0", net_sales: "0" },
    { month: "2026-01-01", product_title: "B", net_items_sold: "0", net_sales: "0" },
  ];
  const { trend, trendTruncated } = buildProductPerformance({ ...empty, trend: rows });
  assert.deepEqual(trend.A.map((point) => point.month), ["2026-01", "2026-02"]);
  assert.equal(trend.B, undefined);
  assert.equal(trendTruncated, false);
  assert.equal(buildProductPerformance({ ...empty, trend: Array.from({ length: trendRowCap }, () => rows[0]) }).trendTruncated, true);
});
