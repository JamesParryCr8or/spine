import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

const stateCookie = "spine-google-ads-oauth-state";

type GoogleTokenResponse = { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
type AccessibleCustomersResponse = { resourceNames?: string[]; error?: { message?: string } };
type GoogleAdsAccount = { customer_id: string; name: string; is_manager: boolean; hierarchy_level: number; direct_access: boolean };
type SearchStreamResponse = Array<{ results?: Array<{ customer?: { id?: string; descriptiveName?: string }; customerClient?: { id?: string; descriptiveName?: string; manager?: boolean; level?: number; status?: string } }> }>;

function fail(request: Request, message: string) {
  const url = new URL("/protected", request.url);
  url.searchParams.set("connectionError", message);
  return NextResponse.redirect(url);
}

function headers(accessToken: string, developerToken: string, loginCustomerId?: string) {
  return {
    Authorization: "Bearer " + accessToken,
    "developer-token": developerToken,
    "Content-Type": "application/json",
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

async function search(accessToken: string, developerToken: string, customerId: string, query: string) {
  const response = await fetch("https://googleads.googleapis.com/v25/customers/" + customerId + ":googleAds:searchStream", {
    method: "POST",
    headers: headers(accessToken, developerToken, customerId),
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  return { response, payload: await response.json().catch(() => []) as SearchStreamResponse };
}

export async function GET(request: Request) {
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) return fail(request, "Google Ads authorization was cancelled or denied");
  if (!code || !state) return fail(request, "Google Ads did not return an authorization code");

  const statePattern = new RegExp("(?:^|; )" + stateCookie + "=([^;]+)");
  const cookieState = request.headers.get("cookie")?.match(statePattern)?.[1];
  if (!cookieState || cookieState !== state) return fail(request, "Google Ads authorization expired. Start the connection again.");

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return fail(request, "No active brand was found");
  const { supabase, store, membership } = workspace;
  if (!["owner", "admin"].includes(membership.role)) return fail(request, "Owner or admin access is required");

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !developerToken || !redirectUri) return fail(request, "Google Ads is missing server configuration in Vercel");

  const exchange = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    cache: "no-store",
  });
  const token = await exchange.json().catch(() => ({})) as GoogleTokenResponse;
  if (!exchange.ok || !token.access_token || !token.refresh_token) return fail(request, token.error_description ?? token.error ?? "Google did not issue a reusable Google Ads authorization");

  const customersResponse = await fetch("https://googleads.googleapis.com/v25/customers:listAccessibleCustomers", {
    headers: headers(token.access_token, developerToken),
    cache: "no-store",
  });
  const customers = await customersResponse.json().catch(() => ({})) as AccessibleCustomersResponse;
  if (!customersResponse.ok) return fail(request, customers.error?.message ?? "Google Ads could not list accounts for this user");

  const directCustomerIds = (customers.resourceNames ?? []).map((name) => name.match(/^customers\/(\d+)$/)?.[1]).filter((id): id is string => Boolean(id));
  if (!directCustomerIds.length) return fail(request, "No directly accessible Google Ads accounts were found for this Google user");

  const accountMap = new Map<string, GoogleAdsAccount>();
  for (const customerId of directCustomerIds) {
    const root = await search(token.access_token, developerToken, customerId, "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1");
    const rootCustomer = root.payload[0]?.results?.[0]?.customer;
    accountMap.set(customerId, {
      customer_id: customerId,
      name: rootCustomer?.descriptiveName ?? "Google Ads account " + customerId,
      is_manager: true,
      hierarchy_level: 0,
      direct_access: true,
    });

    const children = await search(token.access_token, developerToken, customerId, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.status FROM customer_client WHERE customer_client.status = 'ENABLED'");
    if (!children.response.ok) continue;
    for (const row of children.payload.flatMap((page) => page.results ?? [])) {
      const child = row.customerClient;
      if (!child?.id) continue;
      const existing = accountMap.get(child.id);
      accountMap.set(child.id, {
        customer_id: child.id,
        name: child.descriptiveName ?? "Google Ads account " + child.id,
        is_manager: Boolean(child.manager),
        hierarchy_level: child.level ?? 1,
        direct_access: existing?.direct_access ?? false,
      });
    }
  }
  const accounts = [...accountMap.values()];
  const initial = accounts.find((account) => account.direct_access) ?? accounts[0];

  const { error: connectionError } = await supabase.rpc("save_data_connection", {
    connection_provider: "google_ads",
    requested_store_id: store.id,
    access_token: token.refresh_token,
    account_id: initial.customer_id,
    account_name: initial.name,
  });
  if (connectionError) return fail(request, "Google Ads was authorized but Spine could not save the connection");

  const { error: clearError } = await supabase.from("google_ads_accounts").delete().eq("store_id", store.id);
  if (clearError) return fail(request, "Google Ads was authorized but Spine could not refresh the account list");
  const { error: accountError } = await supabase.from("google_ads_accounts").upsert(accounts.map((account) => ({
    organization_id: membership.organizationId,
    store_id: store.id,
    ...account,
    updated_at: new Date().toISOString(),
  })), { onConflict: "store_id,customer_id" });
  if (accountError) return fail(request, "Google Ads was authorized but Spine could not save the account list");

  const response = NextResponse.redirect(new URL("/protected?googleAds=select", request.url));
  response.cookies.set(stateCookie, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
