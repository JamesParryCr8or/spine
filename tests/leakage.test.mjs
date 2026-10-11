import assert from "node:assert/strict";
import test from "node:test";

import { buildLeakage, leakageQueries } from "../lib/analytics/leakage.ts";

const empty = { refunds: [], discounts: [], shipping: [], fees: [], salesMonthly: [] };

test("queries are ShopifyQL aggregates over the window", () => {
  for (const query of Object.values(leakageQueries("2026-01-01", "2026-06-30"))) {
    assert.match(query, /^FROM (sales|fees) SHOW /);
    assert.match(query, /SINCE 2026-01-01 UNTIL 2026-06-30/);
  }
});

test("refund rate is refunded value over gross sales, biggest refunds first", () => {
  const { refunds } = buildLeakage({ ...empty, refunds: [
    { product_title: "A", gross_sales: "1000", sales_reversals: "-50", net_items_sold: "9" },
    { product_title: "B", gross_sales: "200", sales_reversals: "-100", net_items_sold: "2" },
    { product_title: "C", gross_sales: "500", sales_reversals: "0", net_items_sold: "5" },
    { product_title: "", gross_sales: "10", sales_reversals: "-5", net_items_sold: "1" },
  ] }, null);
  assert.deepEqual(refunds.map((row) => row.product), ["B", "A"]);
  assert.equal(refunds[0].rate, 0.5);
  assert.equal(refunds[1].rate, 0.05);
});

test("discount margin needs a recorded cost; the no-code row is the baseline", () => {
  const { discounts } = buildLeakage({ ...empty, discounts: [
    { discount_code: "", orders: "100", net_sales: "10000", discounts: "0", gross_profit: "4000", net_sales_without_cost_recorded: "0" },
    { discount_code: "SAVE20", orders: "10", net_sales: "800", discounts: "-200", gross_profit: "200", net_sales_without_cost_recorded: "0" },
    { discount_code: "VIP", orders: "4", net_sales: "300", discounts: "-100", gross_profit: "90", net_sales_without_cost_recorded: "300" },
  ] }, null);
  assert.equal(discounts.baselineMarginPct, 0.4);
  assert.deepEqual(discounts.rows.map((row) => row.code), ["SAVE20", "VIP"]);
  assert.equal(discounts.rows[0].discountRate, 0.2);
  assert.equal(discounts.rows[0].marginPct, 0.25);
  assert.equal(discounts.rows[1].marginPct, null); // partial cost: not shown
});

test("shipping result is charged minus the estimate from default rates, worst first", () => {
  const defaults = { postageAmount: 3, postageBasis: "orders", fulfilmentAmount: 1, fulfilmentBasis: "units" };
  const { shipping } = buildLeakage({ ...empty, shipping: [
    { shipping_country: "United Kingdom", orders: "10", net_items_sold: "12", shipping_charges: "60" },
    { shipping_country: "United States", orders: "4", net_items_sold: "5", shipping_charges: "10" },
  ] }, defaults);
  assert.equal(shipping.hasEstimate, true);
  assert.equal(shipping.rows[0].country, "United States");
  assert.equal(shipping.rows[0].estimatedCost, 17); // 4 orders x 3 + 5 units x 1
  assert.equal(shipping.rows[0].result, -7);
  assert.equal(shipping.rows[1].result, 18); // 60 - (30 + 12)
});

test("without default rates shipping shows revenue only", () => {
  const { shipping } = buildLeakage({ ...empty, shipping: [{ shipping_country: "France", orders: "2", net_items_sold: "2", shipping_charges: "20" }] }, null);
  assert.equal(shipping.hasEstimate, false);
  assert.equal(shipping.rows[0].estimatedCost, null);
  assert.equal(shipping.rows[0].result, null);
});

test("fee rate joins monthly fees to monthly sales", () => {
  const { fees } = buildLeakage({ ...empty,
    fees: [{ month: "2026-04-01", shopify_payments_processing_fees: "20", foreign_exchange_fees: "5", international_fees: "5" }, { month: "2026-05-01", shopify_payments_processing_fees: "3", foreign_exchange_fees: "0", international_fees: "0" }],
    salesMonthly: [{ month: "2026-04-01", total_sales: "1000" }] }, null);
  assert.equal(fees[0].rate, 0.03);
  assert.equal(fees[1].rate, null); // no sales that month
});
