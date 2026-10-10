import assert from "node:assert/strict";
import test from "node:test";

import { isDailySyncDue } from "../lib/analytics/sync-schedule.ts";

const london = "Europe/London";

test("not due before the configured hour in the store's timezone", () => {
  // 05:30 UTC in July is 06:30 BST: the 07:00 slot hasn't arrived.
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T05:30:00Z"), timeZone: london, schedule: { enabled: true, sync_hour: 7 }, lastScheduledRunAt: null }), false);
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T06:05:00Z"), timeZone: london, schedule: { enabled: true, sync_hour: 7 }, lastScheduledRunAt: null }), true);
});

test("runs once per local day", () => {
  const schedule = { enabled: true, sync_hour: 6 };
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T09:00:00Z"), timeZone: london, schedule, lastScheduledRunAt: "2026-07-10T05:10:00Z" }), false);
  assert.equal(isDailySyncDue({ now: new Date("2026-07-11T05:10:00Z"), timeZone: london, schedule, lastScheduledRunAt: "2026-07-10T05:10:00Z" }), true);
});

test("a run just before local midnight does not count for the next local day", () => {
  // 23:30 UTC on 9 Jul is 00:30 BST on 10 Jul: already the new local day.
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T06:00:00Z"), timeZone: london, schedule: { enabled: true, sync_hour: 6 }, lastScheduledRunAt: "2026-07-09T22:30:00Z" }), true);
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T06:00:00Z"), timeZone: london, schedule: { enabled: true, sync_hour: 6 }, lastScheduledRunAt: "2026-07-09T23:30:00Z" }), false);
});

test("disabled stores never run; no row means enabled at 06:00", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  assert.equal(isDailySyncDue({ now, timeZone: london, schedule: { enabled: false, sync_hour: 6 }, lastScheduledRunAt: null }), false);
  assert.equal(isDailySyncDue({ now, timeZone: london, schedule: null, lastScheduledRunAt: null }), true);
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T04:00:00Z"), timeZone: london, schedule: undefined, lastScheduledRunAt: null }), false);
});

test("uses the store's timezone, not UTC", () => {
  // 02:00 UTC is 22:00 the previous day in New York: 21:00 slot already passed there.
  assert.equal(isDailySyncDue({ now: new Date("2026-07-10T02:00:00Z"), timeZone: "America/New_York", schedule: { enabled: true, sync_hour: 21 }, lastScheduledRunAt: "2026-07-09T01:00:00Z" }), true);
});
