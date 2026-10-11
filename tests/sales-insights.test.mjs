import assert from "node:assert/strict";
import test from "node:test";

import { buildSalesInsights, salesInsightQueries } from "../lib/analytics/sales-insights.ts";

const empty = { customers: [], hours: [], weekdays: [], products: [], countries: [], channels: [], discounts: [] };

test("queries are ShopifyQL aggregates over the requested window", () => {
  const queries = salesInsightQueries("2026-01-01", "2026-03-31");
  for (const query of Object.values(queries)) {
    assert.match(query, /^FROM sales SHOW /);
    assert.match(query, /SINCE 2026-01-01 UNTIL 2026-03-31/);
  }
  assert.match(queries.hours, /GROUP BY hour_of_day/);
  assert.match(queries.weekdays, /GROUP BY day_of_week/);
});

test("summary and repeat rate come from the new/returning split", () => {
  const { summary, customerTypes } = buildSalesInsights({ ...empty, customers: [
    { new_or_returning_customer: "New", orders: "6", net_sales: "£600.00", net_items_sold: "7" },
    { new_or_returning_customer: "Returning", orders: "2", net_sales: "200", net_items_sold: "3" },
    { new_or_returning_customer: "", orders: "2", net_sales: "200", net_items_sold: "2" },
  ] });
  assert.equal(summary.orders, 10);
  assert.equal(summary.netSales, 1000);
  assert.equal(summary.aov, 100);
  assert.equal(summary.unitsPerOrder, 1.2);
  assert.equal(summary.repeatRate, 0.25); // 2 of the 8 orders with a known customer type
  assert.deepEqual(customerTypes.map((row) => row.label), ["New customer", "Repeat customer", "Guest / unknown"]);
});

test("hour and weekday buckets use the shop's numbering (weekday 0 = Monday)", () => {
  const { byHour, byWeekday } = buildSalesInsights({ ...empty,
    hours: [{ hour_of_day: "9", orders: "3", net_sales: "300" }, { hour_of_day: "30", orders: "1", net_sales: "10" }],
    weekdays: [{ day_of_week: "0", orders: "4", net_sales: "400" }, { day_of_week: "6", orders: "1", net_sales: "50" }] });
  assert.equal(byHour[9].orders, 3);
  assert.equal(byHour.reduce((total, bucket) => total + bucket.orders, 0), 3); // out-of-range hour ignored
  assert.equal(byWeekday[0].sales, 400);
  assert.equal(byWeekday[6].orders, 1);
});

test("a product with any sale missing a cost is not ranked for margin", () => {
  const { margin } = buildSalesInsights({ ...empty, products: [
    { product_title: "A", net_items_sold: "10", net_sales: "1000", cost_of_goods_sold: "400", gross_profit: "600", net_sales_without_cost_recorded: "0" },
    { product_title: "B", net_items_sold: "5", net_sales: "500", cost_of_goods_sold: "", gross_profit: "", net_sales_without_cost_recorded: "500" },
    { product_title: "", net_items_sold: "1", net_sales: "50", cost_of_goods_sold: "", gross_profit: "", net_sales_without_cost_recorded: "50" },
  ] });
  assert.deepEqual(margin.rows.map((row) => row.product), ["A"]);
  assert.equal(margin.rows[0].margin, 600);
  assert.equal(margin.rows[0].marginPct, 0.6);
  assert.equal(margin.incompleteProducts, 1);
  assert.equal(margin.costedShare, 1000 / 1500);
});

test("discount codes report revenue and the discount given, and cap the discounted share", () => {
  const { discountCodes, summary } = buildSalesInsights({ ...empty,
    customers: [{ new_or_returning_customer: "New", orders: "4", net_sales: "400", net_items_sold: "4" }],
    discounts: [
      { discount_code: "", orders: "3", net_sales: "300", discounts: "0" },
      { discount_code: "SAVE10", orders: "3", net_sales: "100", discounts: "-12.50" },
      { discount_code: "VIP", orders: "2", net_sales: "50", discounts: "-5" },
    ] });
  assert.equal(discountCodes[0].label, "No discount code");
  assert.equal(discountCodes.find((row) => row.label === "SAVE10").discounts, 12.5);
  assert.equal(summary.discountedShare, 1); // 5 code-uses over 4 orders is capped
});

test("rankings drop empty rows and name blanks", () => {
  const { countries, channels } = buildSalesInsights({ ...empty,
    countries: [{ shipping_country: "", orders: "1", net_sales: "10" }, { shipping_country: "United Kingdom", orders: "5", net_sales: "500" }, { shipping_country: "France", orders: "0", net_sales: "0" }],
    channels: [{ sales_channel: "Online Store", orders: "2", net_sales: "200" }] });
  assert.deepEqual(countries.map((row) => row.label), ["United Kingdom", "Unknown"]);
  assert.equal(channels[0].sales, 200);
});
