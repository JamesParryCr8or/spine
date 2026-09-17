import { createBrowserClient } from "@supabase/ssr";

// These values are public browser configuration, not privileged credentials.
// Vercel supplies them at runtime, while the fallbacks keep static client chunks
// functional when the deployment platform does not inline NEXT_PUBLIC values.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://smtrzopjvbjzzqacjkrw.supabase.co";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_HOLshJWsJOyQMj6RX4lzWQ_AXAL00Yo";

export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
