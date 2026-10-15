import test from "node:test";
import assert from "node:assert/strict";
import { reportingFreshness } from "../lib/analytics/reporting-freshness.ts";

const connections = [{ provider: "meta", status: "connected" }, { provider: "google_ads", status: "connected" }];
const run = (completed_at, status) => ({ status: "completed", created_at: completed_at, completed_at, error_message: null,
  results: [{ source: "meta", status, ...(status === "rejected" ? { message: "Old token expired" } : {}) }, { source: "google_ads", status: "fulfilled" }] });

test("a newer direct Meta import supersedes an expired-token background failure", () => {
  const health = reportingFreshness(connections, [run("2026-10-15T10:03:50Z", "rejected")], { meta: "2026-10-15T15:21:22Z" });
  assert.deepEqual(health.sources.find(source => source.source === "meta"), {
    source: "meta", label: "Meta", status: "ok", lastRefreshedAt: "2026-10-15T15:21:22Z", message: null,
  });
  assert.equal(health.sources.find(source => source.source === "google_ads").lastRefreshedAt, "2026-10-15T10:03:50Z");
});

test("a failure after the latest import stays failed and retains its last imported timestamp", () => {
  const health = reportingFreshness(connections, [run("2026-10-15T16:00:00Z", "rejected")], { meta: "2026-10-15T15:21:22Z" });
  const meta = health.sources.find(source => source.source === "meta");
  assert.equal(meta.status, "failed");
  assert.equal(meta.message, "Old token expired");
  assert.equal(meta.lastRefreshedAt, "2026-10-15T15:21:22Z");
});

test("a new connection with imported data is healthy without any background run", () => {
  assert.equal(reportingFreshness(connections, [], { meta: "2026-10-15T15:21:22Z" }).sources[0].status, "ok");
  assert.equal(reportingFreshness(connections, []).sources[0].status, "pending");
});

test("disconnected providers stay excluded even when old import data exists", () => {
  assert.deepEqual(reportingFreshness([{ provider: "meta", status: "error" }], [], { meta: "2026-10-15T15:21:22Z" }).sources, []);
});
