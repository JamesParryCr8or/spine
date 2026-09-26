import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { isRevenueProvider, signState } from "@/lib/revenue/oauth";
import { oauthConfig } from "@/lib/revenue/server";

export async function GET(_request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!isRevenueProvider(provider)) return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store || !["owner", "admin"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const config = oauthConfig(provider);
  if (!config.configured) return NextResponse.json({ error: "This connector needs its OAuth application credentials configured on the server." }, { status: 503 });
  const nonce = crypto.randomUUID();
  const url = new URL(provider === "stripe" ? "https://connect.stripe.com/oauth/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId!, redirect_uri: config.redirectUri!, response_type: "code", state: nonce, scope: provider === "stripe" ? "read_write" : "https://www.googleapis.com/auth/spreadsheets", ...(provider === "google_sheets" ? { access_type: "offline", prompt: "consent" } : {}) }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(`spine-revenue-${provider}`, signState({ nonce, userId: workspace.userId, storeId: workspace.store.id, organizationId: workspace.store.organization_id, expires: Date.now() + 600_000 }, config.signingKey!), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
