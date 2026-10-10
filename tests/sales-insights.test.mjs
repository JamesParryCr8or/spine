import assert from "node:assert/strict";
import test from "node:test";

import { computeSalesInsights, storeDomainFromUrl } from "../lib/analytics/sales-insights.ts";

const order = (id, extra = {}) => ({ id, customerId: `c-${id}`, processedAt: "2026-07-10T09:30:00Z", source: "web", country: "GB", discountCodes: [], netSales: 100, discounts: 0, customerIndex: 1, storeDomain: null, ...extra });
const line = (orderId, key, extra = {}) => ({ orderId, productKey: key, product: key.toUpperCase(), units: 1, netSales: 50, unitCost: 20, ...extra });

test("storeDomainFromUrl takes the host and drops www", () => {
  assert.equal(storeDomainFromUrl("https://www.Hairmax.co.uk/products/laser?x=1"), "hairmax.co.uk");
  assert.equal(storeDomainFromUrl("/products/laser"), null);
  assert.equal(storeDomainFromUrl(null), null);
});

test("hour and weekday use the store timezone", () => {
  // 23:30 UTC on Friday 10 July is 00:30 Saturday in London (BST).
  const result = computeSalesInsights([order("1", { processedAt: "2026-07-10T23:30:00Z" })], [], "Europe/London");
  assert.equal(result.byHour[0].orders, 1);
  assert.equal(result.byWeekday[5].orders, 1);
  assert.equal(result.byWeekday[4].orders, 0);
});

test("combos count orders containing both products, once per order", () => {
  const orders = [order("1"), order("2"), order("3")];
  const lines = [line("1", "a"), line("1", "b"), line("1", "b"), line("2", "a"), line("2", "b"), line("3", "a")];
  const { combos, summary } = computeSalesInsights(orders, lines, "UTC");
  assert.equal(combos.length, 1);
  assert.equal(combos[0].orders, 2);
  assert.equal(combos[0].confidence, 1); // both b-orders also had a
  assert.equal(summary.multiProductShare, 2 / 3);
});

test("a product with any unit missing a cost is not ranked for margin", () => {
  const orders = [order("1"), order("2")];
  const lines = [line("1", "a"), line("2", "a", { unitCost: null }), line("1", "b"), line("2", "b")];
  const { margin } = computeSalesInsights(orders, lines, "UTC");
  assert.deepEqual(margin.rows.map((row) => row.product), ["B"]);
  assert.equal(margin.incompleteProducts, 1);
  assert.equal(margin.rows[0].margin, 60);
  assert.equal(margin.rows[0].marginPct, 0.6);
});

test("storefront domains rank by revenue and report coverage", () => {
  const orders = [order("1", { storeDomain: "hairmax.co.uk", netSales: 300 }), order("2", { storeDomain: "hairmax.co.uk", netSales: 100 }), order("3", { storeDomain: "hairmax.eu", netSales: 50 }), order("4")];
  const { domains } = computeSalesInsights(orders, [], "UTC");
  assert.equal(domains.rows[0].domain, "hairmax.co.uk");
  assert.equal(domains.rows[0].sales, 400);
  assert.equal(domains.rows[0].orders, 2);
  assert.equal(domains.rows[0].aov, 200);
  assert.equal(domains.coverage, 0.75);
});

test("repeat rate ignores orders with unknown customer index", () => {
  const orders = [order("1", { customerIndex: 1 }), order("2", { customerIndex: 3 }), order("3", { customerIndex: null })];
  assert.equal(computeSalesInsights(orders, [], "UTC").summary.repeatRate, 0.5);
});
