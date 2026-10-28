import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createInvitationShareToken, resolveInvitationToken } from "../lib/workspace/invitation-token.ts";

test("resharing preserves the invitation identity and original links", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "invitation-test-secret";
  const original = "a".repeat(43);
  const hash = createHash("sha256").update(original).digest("hex");
  const first = createInvitationShareToken(hash);
  const second = createInvitationShareToken(hash);
  assert.notEqual(first, second);
  assert.equal(resolveInvitationToken(first), hash);
  assert.equal(resolveInvitationToken(second), hash);
  assert.equal(resolveInvitationToken(original), hash);
  assert.ok(!first.includes(hash));
});

test("rejects tampered, malformed, and wrong-key share tokens", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "invitation-test-secret";
  const hash = "b".repeat(64);
  const token = createInvitationShareToken(hash);
  const bytes = Buffer.from(token.slice(3), "base64url");
  bytes[30] ^= 1;
  assert.equal(resolveInvitationToken(`v1.${bytes.toString("base64url")}`), null);
  for (const invalid of ["", hash, "v1.invalid", token + "x", "v2." + token.slice(3)]) {
    assert.equal(resolveInvitationToken(invalid), null);
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY = "different-secret";
  assert.equal(resolveInvitationToken(token), null);
});
