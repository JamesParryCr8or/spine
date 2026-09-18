import { getSupabasePublicEnvironment } from "../lib/env.ts";

try {
  const configuration = getSupabasePublicEnvironment();
  console.log(`Supabase public environment is valid for ${new URL(configuration.url).hostname}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Environment validation failed");
  process.exitCode = 1;
}
