import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnvironment } from "@/lib/env";
import { shopifyGraph } from "@/lib/shopify/graphql";

type Store = { id: string; organization_id: string; shopify_domain?: string | null; currency: string };
type ShopifyQlRow = Record<string, string | number | null>;
type ShopifyQlResult = { shopifyqlQuery: { tableData: { rows: ShopifyQlRow[] } | null; parseErrors: string[] } };
type GoogleAdsRow = { segments?: { date?: string }; customer?: { currencyCode?: string }; metrics?: { costMicros?: string; impressions?: string; clicks?: string } };
type GoogleAdsPayload = Array<{ results?: GoogleAdsRow[] }>;

const freshAfter = () => new Date(Date.now() - 15 * 60 * 1000).toISOString();

export function createReportingClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new Error("Server reporting credentials are not configured");
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const numeric = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

async function readSecret(supabase: SupabaseClient, storeId: string, provider: string) {
  const { data, error } = await supabase.rpc("read_connection_secret_for_server", {
    requested_store_id: storeId,
    connection_provider: provider,
  });
  if (error) throw error;
  return typeof data === "string" && data ? data : null;
}

async function needsRefresh(supabase: SupabaseClient, table: string, storeId: string, dateColumn: string, from: string, to: string) {
  const { data } = await supabase
    .from(table)
    .select(`${dateColumn},synced_at`)
    .eq("store_id", storeId)
    .gte(dateColumn, from)
    .lte(dateColumn, to)
    .gte("synced_at", freshAfter())
    .limit(1);
  return !(data?.length);
}

export async function refreshShopifyReporting(supabase: SupabaseClient, store: Store, from: string, to: string) {
  if (!store.shopify_domain) return;
  const [salesNeedsRefresh, acquisitionNeedsRefresh] = await Promise.all([
    needsRefresh(supabase, "shopify_sales_daily", store.id, "sales_date", from, to),
    needsRefresh(supabase, "shopify_acquisition_daily", store.id, "sales_date", from, to),
  ]);
  if (!salesNeedsRefresh && !acquisitionNeedsRefresh) return;
  const token = await readSecret(supabase, store.id, "shopify");
  if (!token) return;
  const query = (source: string, metrics: string, where = "") => `FROM ${source}\nSHOW ${metrics}\n${where ? `${where}\n` : ""}TIMESERIES day\nSINCE ${from} UNTIL ${to}\nORDER BY day ASC`;
  const run = (shopifyQl: string) => shopifyGraph<ShopifyQlResult>(
    store.shopify_domain!, token,
    `query Reporting($shopifyQl:String!){ shopifyqlQuery(query:$shopifyQl){ tableData{ rows } parseErrors } }`,
    { shopifyQl },
  );
  const sales = await run(query("sales", "gross_sales, discounts, sales_reversals, net_sales, shipping_charges, taxes, total_sales, orders, net_items_sold, cost_of_goods_sold, gross_profit, net_sales_with_cost_recorded, net_sales_without_cost_recorded"));
  const salesError = sales.shopifyqlQuery.parseErrors[0];
  if (salesError) throw new Error(`Shopify reporting query: ${salesError}`);
  const acquisition = await run(query("sales", "customers, total_sales", "WHERE new_or_returning_customer = 'New'"))
    .catch((error) => { console.warn("Shopify acquisition query was skipped", { message: error instanceof Error ? error.message : "Unknown error" }); return null; });
  if (acquisition?.shopifyqlQuery.parseErrors[0]) console.warn("Shopify acquisition query was skipped", { message: acquisition.shopifyqlQuery.parseErrors[0] });
  const fees = await run(query("fees", "shopify_payments_processing_fees, foreign_exchange_fees, managed_markets_fees, international_fees"))
    .catch(() => null);
  const feesByDate = new Map((fees?.shopifyqlQuery.tableData?.rows ?? []).flatMap((row) => {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? [[day, row] as const] : [];
  }));
  const now = new Date().toISOString();
  const rows = (sales.shopifyqlQuery.tableData?.rows ?? []).flatMap((row) => {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const fee = feesByDate.get(day);
    const processing = numeric(fee?.shopify_payments_processing_fees);
    const international = numeric(fee?.international_fees);
    return [{
      organization_id: store.organization_id, store_id: store.id, sales_date: day,
      gross_sales: numeric(row.gross_sales), discounts: numeric(row.discounts), sales_reversals: numeric(row.sales_reversals),
      net_sales: numeric(row.net_sales), shipping_charges: numeric(row.shipping_charges), taxes: numeric(row.taxes),
      total_sales: numeric(row.total_sales), orders: Math.max(0, Math.trunc(numeric(row.orders))),
      net_items_sold: Math.trunc(numeric(row.net_items_sold)), cost_of_goods_sold: numeric(row.cost_of_goods_sold),
      gross_profit: numeric(row.gross_profit), net_sales_with_cost_recorded: numeric(row.net_sales_with_cost_recorded),
      net_sales_without_cost_recorded: numeric(row.net_sales_without_cost_recorded),
      shopify_payments_processing_fees: processing, foreign_exchange_fees: numeric(fee?.foreign_exchange_fees),
      managed_markets_fees: numeric(fee?.managed_markets_fees), international_fees: international,
      total_payment_fees: processing + international, currency: store.currency, synced_at: now,
    }];
  });
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from("shopify_sales_daily").upsert(rows.slice(index, index + 500), { onConflict: "store_id,sales_date" });
    if (error) throw error;
  }
  const acquisitionRows = (acquisition?.shopifyqlQuery.parseErrors.length ? [] : acquisition?.shopifyqlQuery.tableData?.rows ?? []).flatMap((row) => {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    return [{
      organization_id: store.organization_id, store_id: store.id, sales_date: day,
      new_customers: Math.max(0, Math.trunc(numeric(row.customers))),
      new_customer_sales: numeric(row.total_sales), currency: store.currency, synced_at: now,
    }];
  });
  for (let index = 0; index < acquisitionRows.length; index += 500) {
    const { error } = await supabase.from("shopify_acquisition_daily").upsert(acquisitionRows.slice(index, index + 500), { onConflict: "store_id,sales_date" });
    if (error) throw error;
  }
}

async function refreshMeta(supabase: SupabaseClient, store: Store, from: string, to: string) {
  if (!await needsRefresh(supabase, "meta_ad_insights_daily", store.id, "date_start", from, to)) return;
  const [{ data: connection }, token] = await Promise.all([
    supabase.from("data_connections").select("external_account_id,external_account_name").eq("store_id", store.id).eq("provider", "meta").eq("status", "connected").maybeSingle(),
    readSecret(supabase, store.id, "meta"),
  ]);
  if (!connection?.external_account_id || !token) return;
  const params = new URLSearchParams({
    level: "account", time_increment: "1", fields: "account_id,account_name,date_start,date_stop,spend,impressions,clicks",
    time_range: JSON.stringify({ since: from, until: to }), limit: "1000",
  });
  const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(connection.external_account_id)}/insights?${params}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { data?: Array<Record<string, string>>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Meta spend could not be refreshed");
  const now = new Date().toISOString();
  const rows = (payload.data ?? []).filter((row) => row.date_start).map((row) => ({
    organization_id: store.organization_id, store_id: store.id, account_id: row.account_id ?? connection.external_account_id,
    account_name: row.account_name ?? connection.external_account_name, date_start: row.date_start, date_stop: row.date_stop ?? row.date_start,
    spend: numeric(row.spend), impressions: Math.round(numeric(row.impressions)), clicks: Math.round(numeric(row.clicks)),
    currency: store.currency, synced_at: now,
  }));
  if (rows.length) {
    const { error } = await supabase.from("meta_ad_insights_daily").upsert(rows, { onConflict: "store_id,account_id,date_start" });
    if (error) throw error;
  }
}

async function refreshGoogle(supabase: SupabaseClient, store: Store, from: string, to: string) {
  if (!await needsRefresh(supabase, "google_ads_insights_daily", store.id, "insight_date", from, to)) return;
  const [{ data: connection }, refreshToken, { data: managers }] = await Promise.all([
    supabase.from("data_connections").select("external_account_id,external_account_name").eq("store_id", store.id).eq("provider", "google_ads").eq("status", "connected").maybeSingle(),
    readSecret(supabase, store.id, "google_ads"),
    supabase.from("google_ads_accounts").select("customer_id").eq("store_id", store.id).eq("is_manager", true).order("direct_access", { ascending: false }),
  ]);
  if (!connection?.external_account_id || !refreshToken) return;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!clientId || !clientSecret || !developerToken) return;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description ?? "Google Ads authorization could not be refreshed");
  const customerId = connection.external_account_id.replace(/\D/g, "");
  const gaql = `SELECT segments.date, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY segments.date`;
  const loginCandidates = [undefined, ...(managers ?? []).map((manager) => manager.customer_id as string)];
  let payload: GoogleAdsPayload | null = null;
  let failure = "Google Ads spend could not be refreshed";
  for (const loginCustomerId of loginCandidates) {
    const response = await fetch(`https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:searchStream`, {
      method: "POST", cache: "no-store", body: JSON.stringify({ query: gaql }),
      headers: { Authorization: `Bearer ${tokenPayload.access_token}`, "developer-token": developerToken, "Content-Type": "application/json", ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}) },
    });
    const candidate = await response.json().catch(() => []) as GoogleAdsPayload | { error?: { message?: string } };
    if (response.ok && Array.isArray(candidate)) { payload = candidate; break; }
    failure = (!Array.isArray(candidate) ? candidate.error?.message : null) ?? failure;
  }
  if (!payload) throw new Error(failure);
  const now = new Date().toISOString();
  const rows = payload.flatMap((page) => page.results ?? []).flatMap((row) => row.segments?.date ? [{
    organization_id: store.organization_id, store_id: store.id, customer_id: customerId,
    customer_name: connection.external_account_name, insight_date: row.segments.date,
    spend: numeric(row.metrics?.costMicros) / 1_000_000, impressions: Math.round(numeric(row.metrics?.impressions)),
    clicks: Math.round(numeric(row.metrics?.clicks)), currency: row.customer?.currencyCode ?? store.currency, synced_at: now,
  }] : []);
  if (rows.length) {
    const { error } = await supabase.from("google_ads_insights_daily").upsert(rows, { onConflict: "store_id,customer_id,insight_date" });
    if (error) throw error;
  }
}

export async function refreshReportingData(_supabase: SupabaseClient, store: Store, from: string, to: string) {
  const reportingClient = createReportingClient();
  const results = await Promise.allSettled([
    refreshShopifyReporting(reportingClient, store, from, to),
    refreshMeta(reportingClient, store, from, to),
    refreshGoogle(reportingClient, store, from, to),
  ]);
  results.forEach((result, index) => {
    if (result.status === "rejected") console.error("Reporting refresh failed", { source: ["shopify", "meta", "google_ads"][index], message: result.reason instanceof Error ? result.reason.message : "Unknown error" });
  });
}

