import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyGraph } from "@/lib/shopify/graphql";
import { runShopifyImport } from "@/lib/shopify/import";

export const maxDuration = 300;

const REQUIRED_SCOPES = ["read_products", "read_inventory", "read_orders", "read_customers", "read_reports"];

function normalizeShopDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const [connectionResult, storeResult, syncResult] = await Promise.all([
    supabase
      .from("data_connections")
      .select("provider,status,external_account_id,external_account_name,last_verified_at,last_error,granted_scopes")
      .eq("store_id", store.id)
      .eq("provider", "shopify")
      .maybeSingle(),
    supabase
      .from("stores")
      .select("name,shopify_domain,currency,reporting_currency,timezone")
      .eq("id", store.id)
      .single(),
    supabase
      .from("sync_runs")
      .select("status,sync_mode,window_start,window_end,pages_processed,records_processed,warnings,error_message,completed_at,updated_at")
      .eq("store_id", store.id)
      .eq("source", "shopify")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = connectionResult.error ?? storeResult.error ?? syncResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    connection: connectionResult.data,
    store: storeResult.data,
    sync: syncResult.data,
  });
}

/**
 * Connects (or reconnects) Shopify and runs a full import. The import itself
 * lives in lib/shopify/import.ts so the hourly cron job can keep orders
 * current without anyone clicking this.
 */
export async function POST(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, userId, membership, store } = workspace;
  const reportingDb = membership.role === "connector" ? createAdminClient() : supabase;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { shopDomain?: string; accessToken?: string } | null;
  const suppliedToken = body?.accessToken?.trim();
  const shopDomain = normalizeShopDomain(suppliedToken ? body?.shopDomain ?? "" : store.shopify_domain ?? "");
  const savedSecret = suppliedToken ? null : await createAdminClient().rpc("read_connection_secret_for_server", { requested_store_id: store.id, connection_provider: "shopify" });
  const accessToken = suppliedToken || (typeof savedSecret?.data === "string" ? savedSecret.data : "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) return NextResponse.json({ error: "Use your-store.myshopify.com" }, { status: 400 });
  if (!accessToken) return NextResponse.json({ error: "Shopify token is unavailable. Reconnect the store." }, { status: 409 });

  try {
    const shopData = await shopifyGraph<{ shop: { id: string; name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string }; currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(shopDomain, accessToken, `query ShopIdentity { shop { id name myshopifyDomain currencyCode ianaTimezone } currentAppInstallation { accessScopes { handle } } }`);
    const grantedScopes = new Set(shopData.currentAppInstallation.accessScopes.map((scope) => scope.handle));
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length) throw new Error(`Add these Shopify Admin API scopes and reinstall the app: ${missingScopes.join(", ")}`);

    const { error: storeError } = await reportingDb.from("stores").update({ name: shopData.shop.name, shopify_domain: shopData.shop.myshopifyDomain, currency: shopData.shop.currencyCode, reporting_currency: shopData.shop.currencyCode, timezone: shopData.shop.ianaTimezone, updated_at: new Date().toISOString() }).eq("id", store.id);
    if (storeError) throw new Error(storeError.message);
    const { error: connectionError } = await supabase.rpc("save_data_connection", { connection_provider: "shopify", access_token: accessToken, account_id: shopData.shop.id, account_name: shopData.shop.name, requested_store_id: store.id });
    if (connectionError) throw new Error(connectionError.message);
    const { error: scopesError } = await supabase.rpc("record_shopify_connection_scopes", { scopes: [...grantedScopes].sort(), requested_store_id: store.id });
    if (scopesError) throw new Error(scopesError.message);

    const result = await runShopifyImport({
      db: reportingDb,
      store: { id: store.id, organization_id: membership.organizationId },
      shopDomain,
      accessToken,
      shopCurrency: shopData.shop.currencyCode,
      createdBy: userId,
      trigger: "manual",
      includeDailyReport: true,
      catalogue: "always",
    });
    if (result.status === "busy") {
      return NextResponse.json({ error: "A Shopify import is already running. Leave this page open and refresh the dashboard in a few minutes." }, { status: 429, headers: { "Retry-After": "120" } });
    }
    return NextResponse.json({ connection: { provider: "shopify", status: "connected", external_account_id: shopData.shop.id, external_account_name: shopData.shop.name, granted_scopes: [...grantedScopes].sort() }, resumed: result.resumed, sync: { mode: result.mode, windowStart: result.windowStart, windowEnd: result.windowEnd, ...result.counts } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify connection failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, membership, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }
  const { error } = await supabase.rpc("delete_data_connection", {
    connection_provider: "shopify",
    requested_store_id: store.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
