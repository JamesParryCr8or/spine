import assert from "node:assert/strict";
import test from "node:test";

import { calculateProfitPerNewCustomer } from "../lib/analytics/customer-profit.ts";

test("calculates blended period profit per new customer", () => {
  assert.equal(calculateProfitPerNewCustomer(1250, 10), 125);
  assert.equal(calculateProfitPerNewCustomer(-300, 6), -50);
});

test("does not claim profit per new customer without complete profit or new customers", () => {
  assert.equal(calculateProfitPerNewCustomer(null, 10), null);
  assert.equal(calculateProfitPerNewCustomer(100, 0), null);
  assert.equal(calculateProfitPerNewCustomer(Number.NaN, 2), null);
});
