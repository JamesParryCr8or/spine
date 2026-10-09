import assert from "node:assert/strict";
import test from "node:test";

import { computePnl, contiguousSpans, loadPnlInputs, slicePnlInputs } from "../lib/analytics/pnl-engine.ts";

// Minimal in-memory stand-in for the PostgREST query builder: just the
// filters loadPnlInputs() uses, applied to plain row arrays.
const isTimestamp = (value) => typeof value === "string" && value.includes("T");
const compare = (left, right) => {
  if (isTimestamp(left) && isTimestamp(right)) return Date.parse(left) - Date.parse(right);
  return left < right ? -1 : left > right ? 1 : 0;
};

function fakeClient(tables) {
  return {
    from(table) {
      const filters = [];
      const orders = [];
      let window = null;
      let single = false;
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push((row) => row[column] === value); return builder; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return builder; },
        not(column, operator, value) { filters.push((row) => (row[column] ?? null) !== value); return builder; },
        gte(column, value) { filters.push((row) => compare(row[column], value) >= 0); return builder; },
        lte(column, value) { filters.push((row) => compare(row[column], value) <= 0); return builder; },
        lt(column, value) { filters.push((row) => compare(row[column], value) < 0); return builder; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return builder; },
        or(expression) {
          const match = /^processed_at\.gt\.(.+),and\(processed_at\.eq\.(.+),id\.gt\.(.+)\)$/.exec(expression);
          assert.ok(match, `unsupported or(): ${expression}`);
          const [, after, at, id] = match;
          filters.push((row) => compare(row.processed_at, after) > 0 || (compare(row.processed_at, at) === 0 && row.id > id));
          return builder;
        },
        order(column, options) { orders.push([column, options?.ascending === false ? -1 : 1]); return builder; },
        range(from, to) { window = [from, to + 1]; return builder; },
        limit(count) { window = [0, count]; return builder; },
        maybeSingle() { single = true; return builder; },
        then(resolve, reject) {
          let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          rows = [...rows].sort((left, right) => {
            for (const [column, direction] of orders) {
              const result = compare(left[column], right[column]);
              if (result) return result * direction;
            }
            return 0;
          });
          if (window) rows = rows.slice(...window);
          const result = single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const store = { id: "store-1", currency: "GBP", timezone: "Europe/London" };
const other = { store_id: "store-2" };

function fixture() {
  const orders = [];
  const lines = [];
  const refunds = [];
  const transactions = [];
  const add = (id, processedAt, currency, net, extra = {}) => {
    orders.push({
      id, store_id: store.id, processed_at: processedAt, cancelled_at: null, test: false, currency,
      gross_sales: String(net + 10), discounts: "10", net_product_sales: String(net), shipping_revenue: "4.95",
      tax: String(net * 0.2), duties: "0", total_sales: String(net + 4.95), ...extra,
    });
    lines.push({ id: `${id}-l1`, order_id: id, variant_gid: "gid://v/1", sku: "SKU-1", current_quantity: 2, net_sales: String(net * 0.6) });
    lines.push({ id: `${id}-l2`, order_id: id, variant_gid: null, sku: "NOCOST", current_quantity: 1, net_sales: String(net * 0.4) });
    transactions.push({
      id: `${id}-t1`, order_id: id, status: "SUCCESS", gateway: Number(id.slice(1)) % 3 ? "shopify_payments" : "paypal",
      amount: String(net + 4.95), currency, fee_amount: Number(id.slice(1)) % 2 ? "1.20" : "0", fee_tax: "0",
      processed_at_shopify: processedAt, created_at_shopify: processedAt,
    });
  };
  let index = 0;
  for (let day = 1; day <= 90; day += 1) {
    const date = new Date(Date.UTC(2026, 0, day));
    const iso = date.toISOString().slice(0, 10);
    add(`o${++index}`, `${iso}T10:15:00Z`, "GBP", 40 + (day % 7) * 5);
    if (day % 4 === 0) add(`o${++index}`, `${iso}T18:30:00.123456+00:00`, "USD", 60);
    if (day % 9 === 0) add(`o${++index}`, `${iso}T12:00:00Z`, "EUR", 80);
  }
  // Store-local boundaries: 31 Jan 23:59:59.999 London is still January;
  // 31 Mar 23:30 UTC is 1 Apr 00:30 BST, so it belongs to April.
  add(`o${++index}`, "2026-01-31T23:59:59.999Z", "GBP", 33);
  add(`o${++index}`, "2026-03-31T23:30:00Z", "GBP", 77);
  // Rows the P&L must ignore.
  orders.push({ ...orders[0], id: "cancelled", cancelled_at: "2026-01-02T00:00:00Z" });
  orders.push({ ...orders[0], id: "test-order", test: true });
  orders.push({ ...orders[0], id: "other-store", ...other });
  refunds.push({ id: "r1", order_id: "o3", total_refunded: "12.50" });
  refunds.push({ id: "r2", order_id: "o40", total_refunded: "20" });

  // Shopify's own daily report only covers February: January and March fall
  // back to imported orders, February uses the reported totals.
  const salesDaily = [];
  for (let day = 1; day <= 28; day += 1) {
    const date = `2026-02-${String(day).padStart(2, "0")}`;
    salesDaily.push({
      store_id: store.id, sales_date: date, gross_sales: "500", discounts: "-20", sales_reversals: "-10", net_sales: "470",
      shipping_charges: "30", taxes: "94", total_sales: "594", orders: 9, net_items_sold: 21,
      total_payment_fees: day % 5 ? "8.40" : "0", cost_of_goods_sold: "150", net_sales_without_cost_recorded: "40",
    });
  }

  const marketing = (prefix, dateColumn, currency) => Array.from({ length: 95 }, (_, offset) => ({
    id: `${prefix}-${String(offset).padStart(3, "0")}`, store_id: store.id,
    [dateColumn]: new Date(Date.UTC(2025, 11, 30 + offset)).toISOString().slice(0, 10), spend: String(25 + (offset % 4)), currency,
  }));

  return {
    shopify_sales_daily: salesDaily,
    exchange_rates: [
      { store_id: store.id, base_currency: "USD", quote_currency: "GBP", rate: 0.8, effective_date: "2025-12-01" },
      { store_id: store.id, base_currency: "USD", quote_currency: "GBP", rate: 0.78, effective_date: "2026-02-15" },
    ],
    shopify_orders: orders,
    shopify_order_lines: lines,
    shopify_refunds: refunds,
    shopify_transactions: transactions,
    shopify_variants: [{ id: "v1", store_id: store.id, shopify_gid: "gid://v/1", sku: "SKU-1", shopify_unit_cost: "6.50" }],
    product_costs: [{ id: "c1", store_id: store.id, variant_id: "v1", sku: null, amount: "7.25", effective_from: "2026-02-10", effective_to: null, source: "manual" }],
    custom_costs: [
      { id: "cc1", store_id: store.id, name: "Software", category: "software", amount: "300", currency: "GBP", cadence: "monthly", allocation_basis: "fixed", effective_from: "2025-06-01", effective_to: null },
      { id: "cc2", store_id: store.id, name: "Packaging", category: "packaging", amount: "0.4", currency: "GBP", cadence: "daily", allocation_basis: "orders", effective_from: "2026-01-15", effective_to: "2026-03-10" },
      { id: "cc3", store_id: store.id, name: "Photo shoot", category: "creative", amount: "900", currency: "GBP", cadence: "one_off", allocation_basis: "revenue", effective_from: "2026-02-20", effective_to: null },
      { id: "cc4", store_id: store.id, name: "Courier", category: "fulfilment", amount: "2", currency: "GBP", cadence: "daily", allocation_basis: "units", effective_from: "2026-03-01", effective_to: null },
    ],
    payment_fee_rules: [{ id: "p1", store_id: store.id, gateway: "shopify_payments", percentage_rate: "1.9", fixed_fee: "0.25", tax_rate: "0", minimum_fee: "0", currency: "GBP", effective_from: "2025-01-01", effective_to: null }],
    product_shipping_costs: [{ id: "s1", store_id: store.id, variant_id: "v1", sku: null, amount: "1.10", allocation_basis: "units", currency: "GBP", effective_from: "2026-01-20", effective_to: "2026-03-05" }],
    store_cost_defaults: [{ store_id: store.id, fulfilment_amount: "1.5", fulfilment_basis: "orders", postage_amount: "3.2", postage_basis: "orders", default_cogs_percent: "35", currency: "GBP" }],
    payment_fee_estimate_settings: [{ store_id: store.id, shopify_plan: "Grow", plan_override: null, default_percentage_rate: "2", default_fixed_fee: "0.23", surcharge_rate_override: null }],
    shopify_payment_gateway_daily: Array.from({ length: 90 }, (_, offset) => ({
      store_id: store.id, payment_date: new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10),
      gateway: "paypal", gross_payments: "120", transactions: 2, currency: "GBP",
    })),
    meta_ad_insights_daily: marketing("m", "date_start", "GBP"),
    google_ads_insights_daily: marketing("g", "insight_date", "USD"),
    bing_ads_insights_daily: marketing("b", "insight_date", "GBP"),
    data_connections: [{ store_id: store.id, provider: "bing_ads", status: "connected", last_error: null }],
  };
}

const withoutTimestamp = ({ calculatedAt, ...rest }) => rest;

async function direct(client, period) {
  const loaded = await loadPnlInputs(client, store, period);
  assert.ok(loaded.ok, loaded.error);
  return withoutTimestamp(computePnl(loaded.inputs, store));
}

test("a period sliced from a wider load matches loading that period directly", async () => {
  const client = fakeClient(fixture());
  const span = await loadPnlInputs(client, store, { from: "2025-12-01", to: "2026-04-30" });
  assert.ok(span.ok, span.error);
  const periods = [
    { from: "2026-01-01", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-02-28" },
    { from: "2026-03-01", to: "2026-03-31" },
    { from: "2026-04-01", to: "2026-04-30" },
    { from: "2026-02-09", to: "2026-02-15" },
    { from: "2026-01-25", to: "2026-02-05" },
    { from: "2026-03-29", to: "2026-04-01" },
    { from: "2026-01-31", to: "2026-01-31" },
    { from: "2025-12-01", to: "2025-12-31" },
  ];
  for (const period of periods) {
    const sliced = withoutTimestamp(computePnl(slicePnlInputs(span.inputs, store, period), store));
    assert.deepStrictEqual(sliced, await direct(client, period), `${period.from}..${period.to}`);
  }
});

test("the fixture actually exercises the boundary and mixed-source cases", async () => {
  const client = fakeClient(fixture());
  const january = await direct(client, { from: "2026-01-01", to: "2026-01-31" });
  const march = await direct(client, { from: "2026-03-01", to: "2026-03-31" });
  const april = await direct(client, { from: "2026-04-01", to: "2026-04-30" });
  const february = await direct(client, { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(january.currencyCoverage.convertedOrders > 0, true);
  assert.equal(january.currencyCoverage.excludedOrders > 0, true);
  assert.equal(january.period.end, "2026-01-31");
  assert.equal(april.metrics.orders, 1, "the 31 Mar 23:30 UTC order is 1 Apr in London");
  assert.equal(march.metrics.orders > 0, true);
  assert.equal(february.metrics.orders, 9 * 28, "February uses Shopify's daily report");
  assert.equal(february.metrics.marketingSpend > 0, true);
  assert.equal(january.metrics.fixedOperatingExpenses > 0, true);
});

test("unbounded load matches the all-time slice", async () => {
  const client = fakeClient(fixture());
  const all = await loadPnlInputs(client, store, { from: null, to: null });
  assert.ok(all.ok);
  assert.deepStrictEqual(
    withoutTimestamp(computePnl(slicePnlInputs(all.inputs, store, { from: null, to: null }), store)),
    await direct(client, { from: null, to: null }),
  );
});

test("contiguousSpans merges adjacent periods and keeps gaps apart", () => {
  assert.deepStrictEqual(contiguousSpans([
    { start: "2026-02-01", end: "2026-02-28" },
    { start: "2026-01-01", end: "2026-01-31" },
    { start: "2025-01-01", end: "2025-01-31" },
    { start: "2026-01-10", end: "2026-01-12" },
    { start: "2026-03-02", end: "2026-03-05" },
  ]), [
    { from: "2025-01-01", to: "2025-01-31" },
    { from: "2026-01-01", to: "2026-02-28" },
    { from: "2026-03-02", to: "2026-03-05" },
  ]);
});
