import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnvironment } from "@/lib/env";

/**
 * The only service-role Supabase client. It bypasses RLS, so use it only for
 * what a signed-in user's client cannot do: reading stored connection
 * secrets, cron jobs that work across every store, writes on behalf of
 * store-scoped "connector" members, and team/invitation management.
 * Tenant data that a request reads for its own store goes through the
 * user's client (requireWorkspace().supabase) so RLS applies.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new Error("Supabase server key is not configured");
  return createClient(getSupabasePublicEnvironment().url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
