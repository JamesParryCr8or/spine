import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

const stateCookie = "spine-google-ads-oauth-state";

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(workspace.membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Google Ads OAuth is not configured. Add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_REDIRECT_URI in Vercel." }, { status: 503 });
  }

  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  const response = NextResponse.redirect(url);
  response.cookies.set(stateCookie, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
