import assert from "node:assert/strict";
import test from "node:test";

import { budgetFor, evaluateBudgets, formatReport } from "../scripts/bundle-budget.mjs";

const budgets = { default: 500, routes: { "/app": 1000 } };

test("a route uses its own budget, otherwise the default", () => {
  assert.equal(budgetFor("/app", budgets), 1000);
  assert.equal(budgetFor("/other", budgets), 500);
});

test("routes over their budget fail, others pass", () => {
  const { rows, failures } = evaluateBudgets([
    { route: "/app", firstLoadUncompressedJsBytes: 900 },
    { route: "/other", firstLoadUncompressedJsBytes: 501 },
    { route: "/small", firstLoadUncompressedJsBytes: 100 },
  ], budgets);
  assert.deepEqual(failures.map((row) => row.route), ["/other"]);
  assert.equal(rows[0].route, "/app"); // biggest first
});

test("exactly on budget passes", () => {
  assert.equal(evaluateBudgets([{ route: "/x", firstLoadUncompressedJsBytes: 500 }], budgets).failures.length, 0);
});

test("the report names failing routes and says when everything is within budget", () => {
  const failing = formatReport(evaluateBudgets([{ route: "/x", firstLoadUncompressedJsBytes: 900 }], budgets));
  assert.match(failing, /FAIL\s+\/x/);
  assert.match(failing, /1 route over budget/);
  assert.match(formatReport(evaluateBudgets([{ route: "/x", firstLoadUncompressedJsBytes: 1 }], budgets)), /within budget/);
});
