import test from "node:test";
import assert from "node:assert/strict";

import { calculateExternalPaymentFees, shopifyThirdPartyRate } from "../lib/analytics/external-payment-fees.ts";

const settings = {
  shopify_plan: "Grow", plan_override: null, default_percentage_rate: 2,
  default_fixed_fee: 0.23, surcharge_rate_override: null,
};

test("estimates the fixed processor fee per successful payment and excludes Shopify Payments", () => {
  const result = calculateExternalPaymentFees([
    { payment_date: "2026-09-01", gateway: "PayPal", gross_payments: 100, transactions: 3, currency: "GBP" },
    { payment_date: "2026-09-01", gateway: "Shopify Payments", gross_payments: 200, transactions: 2, currency: "GBP" },
    { payment_date: "2026-09-01", gateway: "Gift Card", gross_payments: 20, transactions: 1, currency: "GBP" },
  ], [], settings, "GBP");
  assert.ok(Math.abs(result.processorFees - 2.69) < 1e-8);
  assert.equal(result.shopifySurcharge, 1);
  assert.equal(result.transactions, 3);
  assert.deepEqual(result.byGateway.map((entry) => entry.gateway), ["PayPal"]);
});

test("processor-specific rates and plan override replace defaults", () => {
  const result = calculateExternalPaymentFees([
    { payment_date: "2026-09-01", gateway: "Klarna", gross_payments: 100, transactions: 2, currency: "GBP" },
  ], [{ gateway: "Klarna", currency: "GBP", effectiveFrom: "2026-01-01", effectiveTo: null,
    percentageRate: 3, fixedFee: 0.3, taxRate: 0, minimumFee: 0 }],
  { ...settings, plan_override: "Plus" }, "GBP");
  assert.equal(result.processorFees, 3.6);
  assert.equal(result.shopifySurcharge, 0.2);
  assert.equal(result.surchargeRate, 0.2);
});

test("unknown plan does not invent a Shopify surcharge", () => {
  assert.equal(shopifyThirdPartyRate("Other"), null);
  const result = calculateExternalPaymentFees([
    { payment_date: "2026-09-01", gateway: "PayPal", gross_payments: 100, transactions: 1, currency: "GBP" },
  ], [], { ...settings, shopify_plan: "Other" }, "GBP");
  assert.equal(result.shopifySurcharge, 0);
  assert.equal(result.surchargeRate, null);
});

test("PayPal Express has no Shopify surcharge when Shopify Payments is present", () => {
  const result = calculateExternalPaymentFees([
    { payment_date: "2026-09-01", gateway: "PayPal Express Checkout", gross_payments: 100, transactions: 1, currency: "GBP" },
    { payment_date: "2026-09-01", gateway: "Shopify Payments", gross_payments: 100, transactions: 1, currency: "GBP" },
  ], [], settings, "GBP");
  assert.equal(result.shopifySurcharge, 0);
  assert.equal(result.processorFees, 2.23);
});
