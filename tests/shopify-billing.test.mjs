import assert from "node:assert/strict";
import test from "node:test";
import { billingHeaders, parseBillingCsv, defaultBillingInclusion } from "../lib/shopify/billing-csv.ts";
import { billingPeriodCosts, billingReportingAmount, estimateBillingCosts, billingItemKey } from "../lib/analytics/billing-costs.ts";

const base = { "Bill #": "123", "Store Name": "Example", "Shop ID": "42", ".myshopify.com URL": "https://example.com", "Charge category": "application_fee", Description: "App, with \"quotes\"\nand a newline", Amount: "10.50", Currency: "USD", Date: "2026-10-14", "Original amount": "8", "Original currency": "GBP", "Exchange rate": "1.3125", "Charge date": "2026-10-13" };
function csv(rows, headers = billingHeaders) { return [headers, ...rows.map(r => headers.map(h => r[h] ?? ""))].map(r => r.map(c => `"${c.replaceAll('"', '""')}"`).join(",")).join("\r\n"); }
test("preserves all columns, quoting, newlines and reordered columns", () => {
  const [row] = parseBillingCsv("\ufeff" + csv([base], [...billingHeaders].reverse()));
  assert.equal(row.description, base.Description); assert.equal(row.raw["Exchange rate"], "1.3125");
  assert.equal(row.original_amount, "8"); assert.equal(row.amount, "10.5");
});

const history = Array.from({ length: 12 }, (_, i) => ({ bill_number: `${i + 1}`, charge_date: new Date(Date.UTC(2024, 9 + i, 5)).toISOString().slice(0, 10), amount: "310", currency: "GBP", original_amount: null, original_currency: null, include_in_pnl: true, category: "application_fee", raw: { App: "Example App" } }));
const coverage = [{ covered_from: "2024-10-01", covered_to: "2025-09-30" }];
const settings = { enabled: true, overrides: {} };
const estimates = (rows = history, ranges = coverage, config = settings, from = "2025-10-01", to = "2025-10-31") => estimateBillingCosts(rows, "GBP", [], ranges, config, "2025-10-15", from, to);
test("uses twelve completed months, daily proration and current month only", () => {
  const result = estimates(); assert.equal(result.monthsUsed, 12); assert.equal(result.items[0].monthlyAverage, 310); assert.equal(result.total, 150);
  assert.equal(estimates(history, coverage, settings, "2025-09-01", "2025-09-30").total, 0);
  assert.equal(estimates(history, coverage, settings, "2025-10-10", "2025-10-12").total, 30);
});
test("imported periods replace estimates, including days with zero charges", () => {
  const result = estimates(history, [...coverage, { covered_from: "2025-10-01", covered_to: "2025-10-10" }]);
  assert.equal(result.total, 50);
  assert.equal(estimates(history, [...coverage, { covered_from: "2025-10-01", covered_to: "2025-10-31" }]).total, 0);
});
test("master and item switches do not remove actuals; variable estimates default off", () => {
  assert.equal(estimates(history, coverage, { enabled: false, overrides: {} }).total, 0);
  assert.equal(estimates(history, coverage, { enabled: true, overrides: { [billingItemKey(history[0])]: false } }).total, 0);
  const variable = history.map(c => ({ ...c, category: "shopify_collabs_commission", raw: {} }));
  assert.equal(estimates(variable).total, 0);
  assert.equal(estimates(variable, coverage, { enabled: true, overrides: { [billingItemKey(variable[0])]: true } }).total, 150);
  assert.equal(billingPeriodCosts(history, "GBP", [], "2024-10-01", "2025-09-30").total, 3720);
});
test("fixed app cycles suppress estimates even beyond the imported period", () => {
  const billed = { ...history[0], charge_date: "2025-10-01", raw: { App: "Example App", "Start of billing cycle": "2025-10-01", "End of billing cycle": "2025-10-31" } };
  assert.equal(estimates([...history, billed]).total, 0);
});
test("partial history uses only complete covered months and missing FX is not guessed", () => {
  assert.equal(estimates(history, [{ covered_from: "2025-09-01", covered_to: "2025-09-30" }]).monthsUsed, 1);
  assert.equal(estimates(history, []).total, 0);
  const missing = estimates(history.map(c => ({ ...c, currency: "USD" })));
  assert.equal(missing.total, 0); assert.equal(missing.missingRates, 1);
});
test("charge identity survives billing and reordering; repeated identical charges remain distinct", () => {
  const unbilled = { ...base, "Bill #": "", Date: "" };
  assert.equal(parseBillingCsv(csv([unbilled]))[0].charge_key, parseBillingCsv(csv([base]))[0].charge_key);
  const other = { ...base, Description: "Other" };
  const a = parseBillingCsv(csv([base, base, other])); const b = parseBillingCsv(csv([other, base, base]));
  assert.deepEqual(a.map(r => r.charge_key).sort(), b.map(r => r.charge_key).sort());
  assert.equal(new Set(a.map(r => r.charge_key)).size, 3);
});
test("rejects malformed dates, missing columns, partial original money and invalid amounts", () => {
  for (const change of [{ "Charge date": "2026-02-30" }, { Amount: "NaN" }, { Amount: "1e6" }, { Currency: "XYZ" }, { "Original currency": "" }]) assert.throws(() => parseBillingCsv(csv([{ ...base, ...change }])));
  assert.throws(() => parseBillingCsv("Amount,Currency\n12,USD"));
  assert.throws(() => parseBillingCsv(csv([base]) + '\n"unclosed'));
});
test("unknown and overlapping payment categories require review", () => {
  assert.equal(defaultBillingInclusion("application_fee"), true);
  assert.equal(defaultBillingInclusion("shopify_collabs_commission"), true);
  assert.equal(defaultBillingInclusion("order_commission"), false);
  assert.equal(defaultBillingInclusion("new_unknown_category"), false);
});
test("P&L counts billed selected charges and credits once, using charge dates and original currency", () => {
  const charge = { ...parseBillingCsv(csv([base]))[0], include_in_pnl: true };
  assert.equal(billingReportingAmount(charge, "GBP", []), 8);
  assert.equal(billingReportingAmount(charge, "EUR", []), null);
  assert.equal(billingReportingAmount(charge, "EUR", [{ base_currency: "USD", quote_currency: "EUR", rate: "0.9", effective_date: "2026-10-01" }]), 9.45);
  const rows = [charge, { ...charge, original_amount: "-3", amount: "-4" }, { ...charge, bill_number: null }, { ...charge, include_in_pnl: false }, { ...charge, charge_date: "2026-09-01" }];
  assert.deepEqual(billingPeriodCosts(rows, "GBP", [], "2026-10-01", "2026-10-31"), { total: 5, missingRates: 0 });
  assert.deepEqual(billingPeriodCosts([charge], "EUR", [], "2026-10-01", "2026-10-31"), { total: 0, missingRates: 1 });
});
