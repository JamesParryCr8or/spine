import assert from "node:assert/strict";
import test from "node:test";
import { metaLoginUrl, exchangeMetaCode } from "../lib/connections/meta-login.ts";
import { sealMetaSession, openMetaSession } from "../lib/connections/meta-oauth.ts";

const options = { appId: "123", appSecret: "test-secret", redirectUri: "https://spine.example/callback", state: "nonce", code: "test-code" };

test("business login invokes the asset configuration without overriding its permissions", () => {
  const url = metaLoginUrl({ ...options, configurationId: "456" });
  assert.equal(url.searchParams.get("config_id"), "456");
  assert.equal(url.searchParams.has("scope"), false);
  assert.equal(url.searchParams.get("redirect_uri"), options.redirectUri);
  assert.equal(url.searchParams.get("state"), "nonce");
  assert.equal(metaLoginUrl(options).searchParams.get("scope"), "ads_read");
});

test("business tokens survive callback without the incompatible user-token extension", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(new URL(url));
    if (calls.length > 1) throw new Error("system-user token cannot be re-exchanged");
    return Response.json({ access_token: "business-token" });
  });
  assert.equal(await exchangeMetaCode({ ...options, configurationId: "456" }), "business-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("code"), "test-code");
});

test("classic user login extends the token and reports failed exchanges", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    calls++;
    const params = new URL(url).searchParams;
    if (calls === 1) return Response.json({ access_token: "short-token" });
    assert.equal(params.get("grant_type"), "fb_exchange_token");
    assert.equal(params.get("fb_exchange_token"), "short-token");
    return Response.json({ access_token: "long-token" });
  });
  assert.equal(await exchangeMetaCode(options), "long-token");
  assert.equal(calls, 2);
  globalThis.fetch = async () => Response.json({ error: { message: "Invalid authorization code" } }, { status: 400 });
  await assert.rejects(exchangeMetaCode(options), /Invalid authorization code/);
});

test("configuration and pending credential stay bound to the initiating user and store", () => {
  const context = { userId: "user", storeId: "store", organizationId: "org" };
  const now = Date.now();
  const session = { ...context, nonce: "nonce", expires: now + 600_000, lookbackMonths: 12, loginConfigId: "456", accessToken: "business-token" };
  const sealed = sealMetaSession(session, "secret", "pending");
  assert.equal(sealed.includes("business-token"), false);
  assert.deepEqual(openMetaSession(sealed, "secret", "pending", context, now), session);
  assert.equal(openMetaSession(sealed, "secret", "pending", { ...context, storeId: "other" }, now), null);
  assert.equal(openMetaSession(sealed, "secret", "pending", { ...context, userId: "other" }, now), null);
  assert.equal(openMetaSession(sealed, "secret", "state", context, now), null);
  assert.equal(openMetaSession(sealed, "secret", "pending", context, now + 600_001), null);
});
