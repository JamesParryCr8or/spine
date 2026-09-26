import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { RevenueProvider } from "./oauth";
import { requireWorkspace } from "@/lib/workspace/server";

export type RevenueWorkspace = Extract<Awaited<ReturnType<typeof requireWorkspace>>, { ok: true }>;
export function oauthConfig(provider: RevenueProvider) {
  const prefix = provider === "stripe" ? "STRIPE_CONNECT" : "GOOGLE_SHEETS";
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = provider === "stripe" ? process.env.STRIPE_SECRET_KEY?.trim() : process.env.GOOGLE_SHEETS_CLIENT_SECRET?.trim();
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`]?.trim();
  const signingKey = process.env.REVENUE_OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { clientId, clientSecret, redirectUri, signingKey, configured: Boolean(clientId && clientSecret && redirectUri && signingKey) };
}
export async function saveCredential(workspace: RevenueWorkspace, provider: RevenueProvider, secret: Record<string, unknown>, accountId: string, accountName: string) {
  const { error } = await workspace.supabase.rpc("save_data_connection", { connection_provider: provider, requested_store_id: workspace.store!.id, access_token: JSON.stringify(secret), account_id: accountId, account_name: accountName });
  if (error) throw new Error("Could not securely save the connection");
}
export async function readCredential(workspace: RevenueWorkspace, provider: RevenueProvider) {
  if (!workspace.store || !["owner", "admin"].includes(workspace.membership.role)) throw new Error("Owner or admin access required");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("read_connection_secret_for_server", { requested_store_id: workspace.store.id, connection_provider: provider });
  if (error || !data) throw new Error("Reconnect this account before importing");
  const value = typeof data === "string" ? data : data.access_token;
  return JSON.parse(value) as { access_token: string; refresh_token?: string; stripe_user_id?: string; livemode?: boolean };
}
