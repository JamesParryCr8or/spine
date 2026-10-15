import { NextRequest, NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { canManageConnections } from "@/lib/workspace/permissions";
import { metaStateCookie, metaPendingCookie, metaCookieOptions, openMetaSession, sealMetaSession } from "@/lib/connections/meta-oauth";

export const maxDuration = 60;

const callbackUrl = (request: NextRequest) => process.env.META_OAUTH_REDIRECT_URI
  ?? new URL("/api/connections/meta/callback", request.url).toString();

const redirectToApp = (request: NextRequest, status: "select" | "error", message?: string) => {
  const url = new URL("/protected/connections", request.url);
  url.searchParams.set("metaOAuth", status);
  if (message) url.searchParams.set(status === "error" ? "metaError" : "metaAccount", message);
  const response = NextResponse.redirect(url);
  response.cookies.set(metaStateCookie, "", { ...metaCookieOptions, maxAge: 0 });
  response.cookies.set(metaPendingCookie, "", { ...metaCookieOptions, maxAge: 0 });
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
  const session = openMetaSession(request.cookies.get(metaStateCookie)?.value, process.env.META_APP_SECRET ?? "", "state", { userId: workspace.userId, storeId: workspace.store.id, organizationId: workspace.membership.organizationId });
  if (!code || !state || !session || state !== session.nonce) {
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
    const tokenResponse = await fetch(`https://graph.facebook.com/v22.0/oauth/access_token?${tokenParams}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error?.message ?? "Meta could not complete Facebook sign-in.");

    const extensionParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenPayload.access_token,
    });
    const extensionResponse = await fetch(`https://graph.facebook.com/v22.0/oauth/access_token?${extensionParams}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const extensionPayload = await extensionResponse.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
    if (!extensionResponse.ok || !extensionPayload.access_token) {
      throw new Error(extensionPayload.error?.message ?? "Meta could not extend the Facebook connection.");
    }

    const response = redirectToApp(request, "select");
    response.cookies.set(metaPendingCookie, sealMetaSession({ ...session, expires: Date.now() + 600_000, accessToken: extensionPayload.access_token }, appSecret, "pending"), metaCookieOptions);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (cause) {
    return redirectToApp(request, "error", cause instanceof Error ? cause.message : "Facebook could not be connected.");
  }
}
