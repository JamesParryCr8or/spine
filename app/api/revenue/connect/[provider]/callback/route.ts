import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { isRevenueProvider, verifyState } from "@/lib/revenue/oauth";
import { oauthConfig, saveCredential } from "@/lib/revenue/server";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!isRevenueProvider(provider)) return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
  const url = new URL(request.url), config = oauthConfig(provider), jar = await cookies();
  const saved = jar.get(`spine-revenue-${provider}`)?.value;
  jar.delete(`spine-revenue-${provider}`);
  const state = saved && config.signingKey ? verifyState(saved, config.signingKey, url.searchParams.get("state") || "") : null;
  if (!state || !config.configured) return NextResponse.json({ error: "Connection request expired. Please start again." }, { status: 400 });
  const workspace = await requireWorkspace({ storeId: state.storeId, organizationId: state.organizationId, strict: true });
  if (!workspace.ok) return workspace.response;
  if (!workspace.store || workspace.userId !== state.userId || !["owner", "admin", "connector"].includes(workspace.membership.role)) return NextResponse.json({ error: "Connection workspace no longer available" }, { status: 403 });
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) return NextResponse.redirect(new URL("/protected?revenue_connection=cancelled", request.url));
  try {
    // Authorization codes are single-use. In particular Stripe code exchange must never be retried.
    const response = await fetch(provider === "stripe" ? "https://connect.stripe.com/oauth/token" : "https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId!, client_secret: config.clientSecret!, redirect_uri: config.redirectUri! }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const token = await response.json();
    if (!response.ok || !token.access_token) throw new Error("Authorisation failed");
    if (provider === "stripe") {
      if (!token.stripe_user_id || token.livemode !== true) throw new Error("Connect a live Stripe account");
      await saveCredential(workspace, provider, { access_token: token.access_token, refresh_token: token.refresh_token, stripe_user_id: token.stripe_user_id, livemode: true }, token.stripe_user_id, `Stripe ${token.stripe_user_id}`);
      const progress = await workspace.supabase.from("revenue_connector_settings").upsert({ store_id: workspace.store.id, provider, settings: {}, last_synced_at: null, last_error: null });
      if (progress.error) throw new Error("Could not reset import progress");
    } else {
      if (!token.refresh_token) throw new Error("Google did not grant offline access. Reconnect and accept access.");
      await saveCredential(workspace, provider, { access_token: token.access_token, refresh_token: token.refresh_token }, "google-sheets", "Google Sheets");
    }
    return NextResponse.redirect(new URL("/protected?revenue_connection=connected", request.url));
  } catch {
    return NextResponse.json({ error: "Connection could not be completed. Use a live Stripe account, or grant Google offline access, then start again from Connections." }, { status: 502 });
  }
}
