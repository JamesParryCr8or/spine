import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";

const stateCookie = "spine-bing-ads-oauth-state";
const verifierCookie = "spine-bing-ads-oauth-verifier";
type Account = { Id?: string | number; Name?: string; Number?: string; CurrencyCode?: string; AccountLifeCycleStatus?: string };
type AccountsPayload = { AccountsInfo?: { AccountInfo?: Account[] } | Account[]; User?: { CustomerRoles?: { CustomerRole?: Array<{ CustomerId?: string | number }> } | Array<{ CustomerId?: string | number }> }; Error?: { Message?: string } };

function fail(request: Request, message: string) { const url = new URL("/protected", request.url); url.searchParams.set("bingAdsError", message); return NextResponse.redirect(url); }
function headers(accessToken: string, developerToken: string) { return { Authorization: `Bearer ${accessToken}`, "DeveloperToken": developerToken, "Content-Type": "application/json" }; }

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
  if (url.searchParams.has("error")) return fail(request, "Microsoft Advertising authorization was cancelled or denied");
  const cookies = request.headers.get("cookie") ?? "";
  const cookie = (name: string) => cookies.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1];
  if (!code || !state || cookie(stateCookie) !== state || !cookie(verifierCookie)) return fail(request, "Microsoft Advertising authorization expired. Start the connection again.");
  const workspace = await requireWorkspace(); if (!workspace.ok) return workspace.response;
  if (!workspace.store || !["owner", "admin", "connector"].includes(workspace.membership.role)) return fail(request, "Workspace connector access is required");
  const clientId = process.env.MICROSOFT_ADS_CLIENT_ID?.trim(); const clientSecret = process.env.MICROSOFT_ADS_CLIENT_SECRET?.trim(); const redirectUri = process.env.MICROSOFT_ADS_REDIRECT_URI?.trim(); const developerToken = process.env.MICROSOFT_ADS_DEVELOPER_TOKEN?.trim();
  if (!clientId || !clientSecret || !redirectUri || !developerToken) return fail(request, "Microsoft Advertising is missing server configuration in Vercel");
  const exchange = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code, code_verifier: cookie(verifierCookie)!, scope: "openid offline_access https://ads.microsoft.com/msads.manage" }), cache: "no-store" });
  const token = await exchange.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!exchange.ok || !token.access_token || !token.refresh_token) return fail(request, token.error_description ?? "Microsoft did not issue reusable authorization tokens");
  const userResponse = await fetch("https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query", { method: "POST", headers: headers(token.access_token, developerToken), body: JSON.stringify({}), cache: "no-store" });
  const user = await userResponse.json().catch(() => ({})) as AccountsPayload;
  if (!userResponse.ok) return fail(request, user.Error?.Message ?? "Microsoft Advertising could not find accounts for this user");
  const roles = user.User?.CustomerRoles;
  const customers = (Array.isArray(roles) ? roles : roles?.CustomerRole ?? []).map((role) => String(role.CustomerId ?? "")).filter(Boolean);
  const accounts: Array<{ account_id: string; customer_id: string; name: string; account_number: string | null; currency: string | null; status: string | null }> = [];
  for (const customerId of customers) {
    const result = await fetch("https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/AccountsInfo/Query", { method: "POST", headers: headers(token.access_token, developerToken), body: JSON.stringify({ CustomerId: customerId, OnlyParentAccounts: false }), cache: "no-store" });
    const payload = await result.json().catch(() => ({})) as AccountsPayload;
    if (!result.ok) continue;
    const raw = payload.AccountsInfo;
    const items = Array.isArray(raw) ? raw : raw?.AccountInfo ? (Array.isArray(raw.AccountInfo) ? raw.AccountInfo : [raw.AccountInfo]) : [];
    for (const account of items) if (account.Id != null) accounts.push({ account_id: String(account.Id), customer_id: customerId, name: account.Name || `Microsoft Advertising account ${account.Id}`, account_number: account.Number ?? null, currency: account.CurrencyCode ?? null, status: account.AccountLifeCycleStatus ?? null });
  }
  if (!accounts.length) return fail(request, "No Microsoft Advertising accounts were found for this user");
  const initial = accounts[0]; const selected = accounts.map((account, index) => ({ ...account, organization_id: workspace.membership.organizationId, store_id: workspace.store!.id, is_selected: index === 0, updated_at: new Date().toISOString() }));
  const { error: saveError } = await workspace.supabase.rpc("save_data_connection", { connection_provider: "bing_ads", requested_store_id: workspace.store.id, access_token: JSON.stringify({ refreshToken: token.refresh_token, customerId: initial.customer_id }), account_id: initial.account_id, account_name: initial.name });
  if (saveError) return fail(request, "Microsoft Advertising was authorized but the connection could not be saved");
  await workspace.supabase.from("bing_ads_accounts").delete().eq("store_id", workspace.store.id);
  const { error: accountError } = await workspace.supabase.from("bing_ads_accounts").insert(selected);
  if (accountError) return fail(request, "Microsoft Advertising connected but account choices could not be saved");
  const next = new URL("/protected?bingAds=select", request.url);
  const response = NextResponse.redirect(next);
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 };
  response.cookies.set(stateCookie, "", cookieOptions); response.cookies.set(verifierCookie, "", cookieOptions);
  return response;
}

