import assert from "node:assert/strict";
import test from "node:test";
import { chargeDateRates, syncBillingFx, billingFxNote } from "../lib/shopify/billing-fx.ts";
import { billingReportingAmount } from "../lib/analytics/billing-costs.ts";

const charge = { bill_number: "1", charge_date: "2026-10-11", amount: "100", currency: "USD", original_amount: null, original_currency: null, include_in_pnl: true };
const observation = { date: "2026-10-09", base: "USD", quote: "GBP", rate: 0.75 };
test("deduplicates dates, uses prior published FX and preserves existing exact rates", () => {
  const rates = chargeDateRates([charge, charge], "GBP", [], [observation, { ...observation, date: "2026-10-12", rate: 0.9 }]);
  assert.equal(rates.length, 1);
  assert.equal(rates[0].effective_date, charge.charge_date);
  assert.equal(rates[0].rate, "0.7500000000");
  assert.equal(billingReportingAmount(charge, "GBP", rates), 75);
  assert.equal(chargeDateRates([charge], "GBP", rates, [observation]).length, 0);
  assert.equal(chargeDateRates([{ ...charge, original_currency: "GBP", original_amount: "79" }], "GBP", [], [observation]).length, 0);
});
test("never guesses unavailable, future, invalid or stale observations", () => {
  for (const row of [{ ...observation, date: "2026-09-01" }, { ...observation, date: "2026-10-12" }, { ...observation, rate: NaN }, { ...observation, rate: -1 }]) {
    assert.equal(chargeDateRates([charge], "GBP", [], [row]).length, 0);
  }
  assert.equal(billingReportingAmount(charge, "GBP", [{ base_currency: "USD", quote_currency: "GBP", effective_date: "2026-10-09", rate: "0.75", notes: billingFxNote }]), null);
});
test("provider failure leaves costs flagged, without writes", async () => {
  const db = { from() { assert.fail("must not write without rates"); } };
  const result = await syncBillingFx(db, [charge], "GBP", [], { storeId: "s", organizationId: "o", userId: "u" }, async () => new Response("", { status: 503 }));
  assert.equal(result.added, 0);
  assert.match(result.warnings[0], /503/);
});
test("persists rates in the authorized store and ignores duplicate manual rows", async () => {
  let written;
  const db = { from(table) { assert.equal(table, "exchange_rates"); return { upsert(rows, options) { written = rows; assert.equal(options.ignoreDuplicates, true); return { select: async () => ({ data: [{ id: "r" }], error: null }) }; } }; } };
  const result = await syncBillingFx(db, [charge], "GBP", [], { storeId: "s", organizationId: "o", userId: "u" }, async url => { assert.match(url, /base=USD/); return Response.json([observation]); });
  assert.equal(result.added, 1);
  assert.equal(written[0].store_id, "s");
  assert.equal(written[0].created_by, "u");
});
