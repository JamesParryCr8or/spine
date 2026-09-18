import assert from "node:assert/strict";
import test from "node:test";

import { hasSupabasePublicEnvironment, validateSupabasePublicEnvironment } from "../lib/env.ts";

const publishable = "sb_publishable_test_key";

test("validates Supabase public configuration", () => {
  assert.deepEqual(validateSupabasePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  }), {
    url: "https://project.supabase.co",
    publishableKey: publishable,
  });
  assert.equal(hasSupabasePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  }), true);
});

test("rejects missing, insecure, and privileged Supabase configuration", () => {
  assert.throws(() => validateSupabasePublicEnvironment({}), /Missing required public environment variables/);
  assert.throws(() => validateSupabasePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "http://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  }), /must use HTTPS/);
  assert.throws(() => validateSupabasePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_expose",
  }), /cannot contain a secret/);
});
