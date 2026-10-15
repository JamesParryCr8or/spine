import { NextRequest, NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { canManageConnections } from "@/lib/workspace/permissions";

import { metaStateCookie, metaPendingCookie, metaCookieOptions, sealMetaSession } from "@/lib/connections/meta-oauth";

const errorRedirect = (request: NextRequest, message: string) => {
  const url = new URL("/protected/connections", request.url);
  url.searchParams.set("metaOAuth", "error");
  url.searchParams.set("metaError", message);
  return NextResponse.redirect(url);
};

const callbackUrl = (request: NextRequest) => process.env.META_OAUTH_REDIRECT_URI
  ?? new URL("/api/connections/meta/callback", request.url).toString();

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!canManageConnections(workspace.membership.role)) return NextResponse.json({ error: "Connection management access is required" }, { status: 403 });

  if (!workspace.store) return errorRedirect(request, "Select a brand before connecting Meta.");

  const appId = process.env.META_APP_ID;
  if (!appId || !process.env.META_APP_SECRET) {
    return errorRedirect(request, "Meta OAuth has not been configured yet. Add the Meta app ID and secret in the Spine production environment.");
  }

  const requestedMonths = Number(request.nextUrl.searchParams.get("lookbackMonths"));
  const lookbackMonths = Number.isInteger(requestedMonths) && requestedMonths >= 1 && requestedMonths <= 36 ? requestedMonths : 12;
  const state = crypto.randomUUID();
  const url = new URL("https://www.facebook.com/v22.0/dialog/oauth");
  url.search = new URLSearchParams({ client_id: appId, redirect_uri: callbackUrl(request), state, response_type: "code", scope: "ads_read,read_insights", ...(process.env.META_LOGIN_CONFIG_ID ? { config_id: process.env.META_LOGIN_CONFIG_ID } : {}) }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(metaStateCookie, sealMetaSession({ nonce: state, userId: workspace.userId, storeId: workspace.store.id, organizationId: workspace.membership.organizationId, expires: Date.now() + 600_000, lookbackMonths }, process.env.META_APP_SECRET, "state"), metaCookieOptions);
  response.cookies.set(metaPendingCookie, "", { ...metaCookieOptions, maxAge: 0 });
  return response;
}
