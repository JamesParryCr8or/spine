import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireWorkspace } from "@/lib/workspace/server";

const stateCookie = "spine-bing-ads-oauth-state";
const verifierCookie = "spine-bing-ads-oauth-verifier";

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const clientId = process.env.MICROSOFT_ADS_CLIENT_ID?.trim();
  const redirectUri = process.env.MICROSOFT_ADS_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return NextResponse.json({ error: "Microsoft Advertising OAuth is not configured. Add MICROSOFT_ADS_CLIENT_ID and MICROSOFT_ADS_REDIRECT_URI in Vercel." }, { status: 503 });
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, response_mode: "query", scope: "openid offline_access https://ads.microsoft.com/msads.manage", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
  const response = NextResponse.redirect(url);
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
  response.cookies.set(stateCookie, state, cookieOptions);
  response.cookies.set(verifierCookie, verifier, cookieOptions);
  return response;
}

