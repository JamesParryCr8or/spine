import assert from "node:assert/strict";
import test from "node:test";

import { safeAuthRedirect } from "../lib/auth/redirect.ts";

test("allows local auth destinations", () => {
  assert.equal(safeAuthRedirect("/protected"), "/protected");
  assert.equal(safeAuthRedirect("/protected?view=Reports"), "/protected?view=Reports");
  assert.equal(safeAuthRedirect("/auth/update-password?next=%2Finvite%2Fabc"), "/auth/update-password?next=%2Finvite%2Fabc");
});

test("rejects external and malformed auth destinations", () => {
  assert.equal(safeAuthRedirect("https://example.com"), "/protected");
  assert.equal(safeAuthRedirect("//example.com"), "/protected");
  assert.equal(safeAuthRedirect("/protected\nLocation: https://example.com"), "/protected");
  assert.equal(safeAuthRedirect(null), "/protected");
});
