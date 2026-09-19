import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

const stateCookie = "spine-google-ads-oauth-state";

type GoogleTokenResponse = { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
type AccessibleCustomersResponse = { resourceNames?: string[]; error?: { message?: string } };
type SearchStreamResponse = Array<{ results?: Array<{ customer?: { id?: string; descriptiveName?: string } }> }>;

function fail(request: Request, message: string) {
  const url = new URL("/protected", request.url);
  url.searchParams.set("connectionError", message);
  return NextResponse.redirect(url);
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
  if (!["owner", "admin"].includes(workspace.membership.role)) return fail(request, "Owner or admin access is required");

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !developerToken || !redirectUri) {
    return fail(request, "Google Ads is missing server configuration in Vercel");
  }

  const exchange = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    cache: "no-store",
  });
  const token = await exchange.json().catch(() => ({})) as GoogleTokenResponse;
  if (!exchange.ok || !token.access_token || !token.refresh_token) {
    return fail(request, token.error_description ?? token.error ?? "Google did not issue a reusable Google Ads authorization");
  }

  const customersResponse = await fetch("https://googleads.googleapis.com/v25/customers:listAccessibleCustomers", {
    headers: {
      Authorization: "Bearer " + token.access_token,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const customers = await customersResponse.json().catch(() => ({})) as AccessibleCustomersResponse;
  if (!customersResponse.ok) {
    return fail(request, customers.error?.message ?? "Google Ads could not list accounts for this user");
  }

  const accountId = customers.resourceNames?.map((name) => name.match(/^customers\/(\d+)$/)?.[1]).find(Boolean);
  if (!accountId) return fail(request, "No directly accessible Google Ads accounts were found for this Google user");

  let accountName = "Google Ads account " + accountId;
  const nameResponse = await fetch("https://googleads.googleapis.com/v25/customers/" + accountId + ":googleAds:searchStream", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token.access_token,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1" }),
    cache: "no-store",
  });
  if (nameResponse.ok) {
    const stream = await nameResponse.json().catch(() => []) as SearchStreamResponse;
    accountName = stream[0]?.results?.[0]?.customer?.descriptiveName ?? accountName;
  }

  const { error } = await workspace.supabase.rpc("save_data_connection", {
    connection_provider: "google_ads",
    requested_store_id: workspace.store.id,
    access_token: token.refresh_token,
    account_id: accountId,
    account_name: accountName,
  });
  if (error) return fail(request, "Google Ads was authorized but Spine could not save the connection");

  const response = NextResponse.redirect(new URL("/protected?googleAds=connected", request.url));
  response.cookies.set(stateCookie, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
