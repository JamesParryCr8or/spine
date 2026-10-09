import { test } from "node:test";
import assert from "node:assert/strict";

import { rollingSyncWindow } from "../lib/analytics/reporting-sync-window.ts";

test("rolling window spans the requested number of inclusive days ending today", () => {
  const { from, to } = rollingSyncWindow(4);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(to, today);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  assert.equal(days, 4);
});

test("defaults to a four-day window", () => {
  const { from, to } = rollingSyncWindow();
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  assert.equal(days, 4);
});

test("a one-day window starts and ends on the same date", () => {
  const { from, to } = rollingSyncWindow(1);
  assert.equal(from, to);
});
