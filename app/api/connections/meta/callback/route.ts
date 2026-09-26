import { NextRequest, NextResponse } from "next/server";

import { discoverMetaAccounts, importMetaInsights } from "@/lib/connections/meta";
import { requireWorkspace } from "@/lib/workspace/server";
import { canManageConnections } from "@/lib/workspace/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

const stateCookie = "spine_meta_oauth_state";

const callbackUrl = (request: NextRequest) => process.env.META_OAUTH_REDIRECT_URI
  ?? new URL("/api/connections/meta/callback", request.url).toString();

const redirectToApp = (request: NextRequest, status: "connected" | "error", message?: string) => {
  const url = new URL("/protected", request.url);
  url.searchParams.set("metaOAuth", status);
  if (message) url.searchParams.set(status === "error" ? "metaError" : "metaAccount", message);
  const response = NextResponse.redirect(url);
  response.cookies.set(stateCookie, "", { path: "/", maxAge: 0 });
  return response;
};

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!canManageConnections(workspace.membership.role)) return redirectToApp(request, "error", "Connection management access is required.");
  if (!workspace.store) return redirectToApp(request, "error", "No brand is selected.");

  const returnedError = request.nextUrl.searchParams.get("error_reason") ?? request.nextUrl.searchParams.get("error_message") ?? request.nextUrl.searchParams.get("error");
  if (returnedError) return redirectToApp(request, "error", returnedError);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get(stateCookie)?.value;
  const [expectedState, savedLookback] = savedState?.split(".") ?? [];
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToApp(request, "error", "Your Facebook connection could not be verified. Please try Connect Facebook again.");
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return redirectToApp(request, "error", "Meta OAuth has not been configured yet.");

  try {
    const redirectUri = callbackUrl(request);
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const tokenResponse = await fetch(`https://graph.facebook.com/v22.0/oauth/access_token?${tokenParams}`, { cache: "no-store" });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error?.message ?? "Meta could not complete Facebook sign-in.");

    const extensionParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenPayload.access_token,
    });
    const extensionResponse = await fetch(`https://graph.facebook.com/v22.0/oauth/access_token?${extensionParams}`, { cache: "no-store" });
    const extensionPayload = await extensionResponse.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
    if (!extensionResponse.ok || !extensionPayload.access_token) {
      throw new Error(extensionPayload.error?.message ?? "Meta could not extend the Facebook connection.");
    }

    const accessToken = extensionPayload.access_token;
    const accounts = await discoverMetaAccounts(accessToken);
    const account = accounts[0];
    if (!account) throw new Error("No Meta ad accounts are available to this Facebook account.");

    const { error: connectionError } = await workspace.supabase.rpc("save_data_connection", {
      connection_provider: "meta",
      requested_store_id: workspace.store.id,
      access_token: accessToken,
      account_id: account.id,
      account_name: account.name ?? null,
    });
    if (connectionError) throw new Error(connectionError.message);

    const lookbackMonths = Number(savedLookback);
    await importMetaInsights({
      supabase: workspace.membership.role === "connector" ? createAdminClient() : workspace.supabase,
      organizationId: workspace.membership.organizationId,
      store: workspace.store,
      account,
      accessToken,
      lookbackMonths: Number.isInteger(lookbackMonths) && lookbackMonths >= 1 && lookbackMonths <= 36 ? lookbackMonths : 12,
    });

    return redirectToApp(request, "connected", account.name ?? account.id);
  } catch (cause) {
    return redirectToApp(request, "error", cause instanceof Error ? cause.message : "Facebook could not be connected.");
  }
}
