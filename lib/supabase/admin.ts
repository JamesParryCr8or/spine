import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnvironment } from "@/lib/env";

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new Error("Supabase server key is not configured");
  return createClient(getSupabasePublicEnvironment().url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
