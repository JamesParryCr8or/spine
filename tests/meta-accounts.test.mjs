import test from "node:test";
import assert from "node:assert/strict";
import { discoverMetaAccounts } from "../lib/connections/meta.ts";

function appEnvironment(t) {
  const before = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = "app-secret";
  t.after(() => {
    for (const [key, value] of [["META_APP_ID", before.id], ["META_APP_SECRET", before.secret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("personal tokens retain normal account discovery and pagination", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer private-token");
    return Response.json(calls.length === 1
      ? { data: [{ id: "act_1", name: "Store one" }], paging: { next: "https://graph.facebook.com/v22.0/me/adaccounts?after=cursor" } }
      : { data: [{ id: "act_2", name: "Store two" }] });
  });
  assert.deepEqual((await discoverMetaAccounts("private-token", true)).map(a => a.id), ["act_1", "act_2"]);
  assert.equal(calls.length, 2);
});

test("system-user tokens load assigned accounts after the user edge denies permission", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(new URL(url).pathname);
    if (calls.length === 1) return Response.json({ error: { code: 200, message: "(#200) Missing Permissions" } }, { status: 403 });
    return Response.json({ data: [{ id: "act_1" }, { id: "act_2" }] });
  });
  assert.equal((await discoverMetaAccounts("business-token", true)).length, 2);
  assert.deepEqual(calls, ["/v22.0/me/adaccounts", "/v22.0/me/assigned_ad_accounts"]);
});

test("an empty user edge can still resolve assigned business accounts", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: ++calls === 1 ? [] : [{ id: "act_9" }] }));
  assert.equal((await discoverMetaAccounts("business-token"))[0].id, "act_9");
});

test("invalid tokens fail immediately and both denied edges produce actionable guidance", async t => {
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { code: 190, message: "Access token expired" } }, { status: 400 });
  });
  await assert.rejects(discoverMetaAccounts("expired"), /expired/);
  assert.equal(calls, 1);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: { code: 200, message: "Missing Permissions" } }, { status: 403 }));
  await assert.rejects(discoverMetaAccounts("denied"), /ads_read.*ANALYZE/);
});

test("pagination cannot send the access token outside Meta", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ data: [{ id: "act_1" }], paging: { next: "https://untrusted.example/accounts" } });
  });
  await assert.rejects(discoverMetaAccounts("private-token", true), /unexpected pagination URL/);
  assert.equal(calls, 1);
});

test("business discovery resolves granted ad IDs without querying the unsupported me alias again", async t => {
  appEnvironment(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url); calls.push(parsed.pathname);
    if (parsed.pathname.endsWith("/me/adaccounts")) return Response.json({ error: { code: 200, message: "Missing Permissions" } }, { status: 403 });
    if (parsed.pathname.endsWith("/debug_token")) {
      assert.equal(options.headers.Authorization, "Bearer 123|app-secret");
      assert.equal(parsed.searchParams.get("input_token"), "business-token");
      return Response.json({ data: { app_id: "123", is_valid: true, type: "SYSTEM_USER", scopes: ["ads_read"], granular_scopes: [
        { scope: "ads_read", target_ids: ["11", "22", "11"] },
        { scope: "pages_read_engagement", target_ids: ["99"] },
      ] } });
    }
    assert.equal(options.headers.Authorization, "Bearer business-token");
    assert.match(parsed.pathname, /act_(11|22)$/);
    return Response.json({ id: parsed.pathname.split("/").at(-1), name: "Approved account" });
  });
  assert.deepEqual((await discoverMetaAccounts("business-token", true)).map(account => account.id), ["act_11", "act_22"]);
  assert.deepEqual(calls, ["/v22.0/me/adaccounts", "/v22.0/debug_token", "/v22.0/act_11", "/v22.0/act_22"]);
});

test("tokens without granular IDs enumerate using the inspected numeric system-user ID", async t => {
  appEnvironment(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.endsWith("/me/adaccounts")) return Response.json({ error: { code: 100, message: "Object me does not exist" } }, { status: 400 });
    if (path.endsWith("/debug_token")) return Response.json({ data: { app_id: "123", is_valid: true, user_id: "777", scopes: ["ads_read"] } });
    assert.equal(path, "/v22.0/777/assigned_ad_accounts");
    return Response.json({ data: [{ id: "act_11" }] });
  });
  assert.equal((await discoverMetaAccounts("business-token", true))[0].id, "act_11");
  assert.equal(calls.length, 3);
});

test("invalid grants and grants from another app never load asset details", async t => {
  appEnvironment(t);
  let grant = { app_id: "other", is_valid: true };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    calls++;
    if (new URL(url).pathname.endsWith("/debug_token")) return Response.json({ data: grant });
    return Response.json({ error: { code: 200, message: "Missing Permissions" } }, { status: 403 });
  });
  await assert.rejects(discoverMetaAccounts("wrong-app"), /different app/);
  assert.equal(calls, 2);
  grant = { app_id: "123", is_valid: false };
  await assert.rejects(discoverMetaAccounts("revoked"), /expired or was revoked/);
  assert.equal(calls, 4);
});
