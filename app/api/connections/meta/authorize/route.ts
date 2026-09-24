import { NextRequest, NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

const stateCookie = "spine_meta_oauth_state";

const errorRedirect = (request: NextRequest, message: string) => {
  const url = new URL("/protected", request.url);
  url.searchParams.set("metaOAuth", "error");
  url.searchParams.set("metaError", message);
  return NextResponse.redirect(url);
};

const callbackUrl = (request: NextRequest) => process.env.META_OAUTH_REDIRECT_URI
  ?? new URL("/api/connections/meta/callback", request.url).toString();

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;

  const appId = process.env.META_APP_ID;
  if (!appId || !process.env.META_APP_SECRET) {
    return errorRedirect(request, "Meta OAuth has not been configured yet. Add the Meta app ID and secret in the Spine production environment.");
  }

  const requestedMonths = Number(request.nextUrl.searchParams.get("lookbackMonths"));
  const lookbackMonths = Number.isInteger(requestedMonths) && requestedMonths >= 1 && requestedMonths <= 36 ? requestedMonths : 12;
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(new URL(`https://www.facebook.com/v22.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(callbackUrl(request))}&state=${encodeURIComponent(state)}&response_type=code&scope=ads_read,read_insights`));
  response.cookies.set(stateCookie, `${state}.${lookbackMonths}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
