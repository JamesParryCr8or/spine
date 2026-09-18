type SupabasePublicEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

const decodeJwtRole = (value: string) => {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(normalized)) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
};

export function hasSupabasePublicEnvironment(environment: SupabasePublicEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}) {
  return Boolean(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() && environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
}

export function validateSupabasePublicEnvironment(environment: SupabasePublicEnvironment): SupabasePublicConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing = [
    !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !publishableKey ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : null,
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing required public environment variables: ${missing.join(", ")}`);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url!);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
  }
  const localHttp = parsedUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !localHttp) throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development");
  if (publishableKey!.startsWith("sb_secret_") || decodeJwtRole(publishableKey!) === "service_role") {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY cannot contain a secret or service-role key");
  }
  if (!publishableKey!.startsWith("sb_publishable_") && publishableKey!.split(".").length !== 3) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a recognized publishable key");
  }
  return { url: parsedUrl.toString().replace(/\/$/, ""), publishableKey: publishableKey! };
}

export function getSupabasePublicEnvironment() {
  return validateSupabasePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
