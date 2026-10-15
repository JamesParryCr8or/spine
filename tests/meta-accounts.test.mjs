import test from "node:test";
import assert from "node:assert/strict";
import { discoverMetaAccounts } from "../lib/connections/meta.ts";

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
