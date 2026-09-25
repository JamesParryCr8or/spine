import assert from "node:assert/strict";
import test from "node:test";

import { bucketRepeatOrderGaps } from "../lib/analytics/repeat-order-gaps.ts";

test("fractional day gaps stay in the correct bucket and cover 365 days", () => {
  const buckets = bucketRepeatOrderGaps([4.9, 14.9, 15, 29.9, 95.5, 365.9, 366]);
  assert.equal(buckets.find((row) => row.start === 0)?.count, 2);
  assert.equal(buckets.find((row) => row.start === 15)?.count, 2);
  assert.equal(buckets.find((row) => row.start === 90)?.count, 1);
  assert.equal(buckets.find((row) => row.start === 300)?.count, 1);
  assert.equal(buckets.find((row) => row.start === 366)?.count, 1);
  assert.equal(buckets.reduce((total, row) => total + row.count, 0), 7);
  assert.equal(buckets.at(-1)?.cumulativeShare, 1);
});
