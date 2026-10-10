import assert from "node:assert/strict";
import test, { after } from "node:test";

// The module patches window.fetch after a successful write, so give it a fake window.
const calls = [];
let payloadFor = (url) => ({ url, n: calls.length });
const mockFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  calls.push({ url, method: init?.method ?? "GET" });
  return new Response(JSON.stringify(payloadFor(url)), { status: 200, headers: { "Content-Type": "application/json" } });
};
globalThis.fetch = mockFetch;
globalThis.window = { fetch: mockFetch, location: { origin: "http://localhost" } };

const { fetchJson, peekJson, invalidateJson, initQueryCache, clearQueryCache, getQueryClient } = await import("../lib/queries/client.ts");
initQueryCache("user-1", "store-1");

const reads = (url) => calls.filter((call) => call.url === url && call.method === "GET").length;

test("a second read inside the fresh window makes no request", async () => {
  const first = await fetchJson("/api/analytics/pnl?from=a");
  const second = await fetchJson("/api/analytics/pnl?from=a");
  assert.deepEqual(second, first);
  assert.equal(reads("/api/analytics/pnl?from=a"), 1);
});

test("force always requests, and peek returns the cached copy with its freshness", async () => {
  await fetchJson("/api/analytics/pnl?from=b");
  await fetchJson("/api/analytics/pnl?from=b", { force: true });
  assert.equal(reads("/api/analytics/pnl?from=b"), 2);
  const cached = await peekJson("/api/analytics/pnl?from=b");
  assert.equal(cached?.fresh, true);
  assert.equal(await peekJson("/api/analytics/never-requested"), null);
});

test("invalidate drops only URLs under the prefix", async () => {
  await fetchJson("/api/analytics/pnl?from=c");
  await fetchJson("/api/analytics/utm?from=c");
  invalidateJson("/api/analytics/pnl");
  assert.equal(await peekJson("/api/analytics/pnl?from=c"), null);
  assert.notEqual(await peekJson("/api/analytics/utm?from=c"), null);
});

test("a failed request is not cached and surfaces the API's message", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "No store is configured" }), { status: 404 });
  await assert.rejects(fetchJson("/api/analytics/pnl?from=bad"), /No store is configured/);
  globalThis.fetch = original;
  assert.equal(await peekJson("/api/analytics/pnl?from=bad"), null);
});

test("a successful write to a data API clears the cache; the login refresh does not", async () => {
  await fetchJson("/api/analytics/pnl?from=d");
  await window.fetch("/api/sync/login", { method: "POST" });
  assert.notEqual(await peekJson("/api/analytics/pnl?from=d"), null);
  await window.fetch("/api/costs", { method: "POST", body: "{}" });
  assert.equal(await peekJson("/api/analytics/pnl?from=d"), null);
});

test("reads and writes to other APIs leave the cache alone", async () => {
  await fetchJson("/api/analytics/pnl?from=e");
  await window.fetch("/api/reports/runs", { method: "POST", body: "{}" });
  await window.fetch("/api/analytics/pnl?from=e");
  assert.notEqual(await peekJson("/api/analytics/pnl?from=e"), null);
});

test("clearQueryCache empties everything", async () => {
  await fetchJson("/api/analytics/pnl?from=f");
  await clearQueryCache();
  assert.equal(await peekJson("/api/analytics/pnl?from=f"), null);
});

test("entries are keyed by user and store: another store never sees them", async () => {
  await fetchJson("/api/analytics/pnl?from=g");
  initQueryCache("user-1", "store-2");
  assert.equal(await peekJson("/api/analytics/pnl?from=g"), null);
  initQueryCache("user-1", "store-1");
  assert.notEqual(await peekJson("/api/analytics/pnl?from=g"), null);
});

// TanStack schedules 24h garbage-collection timers per query; clear them so the test process can exit.
after(async () => {
  await clearQueryCache();
  getQueryClient().getQueryCache().clear();
});
