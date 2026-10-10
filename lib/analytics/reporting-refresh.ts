import type { SupabaseClient } from "@supabase/supabase-js";
import { inflateRawSync } from "node:zlib";

import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyGraph } from "@/lib/shopify/graphql";
import { resolveShopifyDailyFees } from "@/lib/analytics/shopify-fees";

type Store = { id: string; organization_id: string; shopify_domain?: string | null; currency: string };
type ShopifyQlRow = Record<string, string | number | null>;
type ShopifyQlResult = { shopifyqlQuery: { tableData: { rows: ShopifyQlRow[] } | null; parseErrors: string[] } };
type GoogleAdsRow = { segments?: { date?: string }; customer?: { currencyCode?: string }; metrics?: { costMicros?: string; impressions?: string; clicks?: string } };
type GoogleAdsPayload = Array<{ results?: GoogleAdsRow[] }>;

const freshAfter = () => new Date(Date.now() - 15 * 60 * 1000).toISOString();

const numeric = (value: unknown) => {
  const number = Number(typeof value === "string" ? value.replace(/[£$,\s]/g, "") : value ?? 0);
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
  const feeParseError = fees?.shopifyqlQuery.parseErrors?.[0];
  if (feeParseError) console.warn("Shopify fee report was skipped", { message: feeParseError });
  const feesByDate = new Map((feeParseError ? [] : fees?.shopifyqlQuery.tableData?.rows ?? []).flatMap((row) => {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? [[day, row] as const] : [];
  }));
  const salesRows = sales.shopifyqlQuery.tableData?.rows ?? [];
  const salesDates = salesRows.flatMap((row) => {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? [day] : [];
  });
  const existingFeesByDate = new Map<string, Record<string, string | number | null>>();
  if (salesDates.length) {
    const { data: existingFeeRows, error: existingFeeError } = await supabase
      .from("shopify_sales_daily")
      .select("sales_date,shopify_payments_processing_fees,foreign_exchange_fees,managed_markets_fees,international_fees,total_payment_fees")
      .eq("store_id", store.id)
      .in("sales_date", salesDates);
    if (existingFeeError) throw new Error(existingFeeError.message);
    for (const row of existingFeeRows ?? []) existingFeesByDate.set(row.sales_date, row);
  }
  const now = new Date().toISOString();
  const rows = salesRows.flatMap((row) => {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const fee = resolveShopifyDailyFees(feesByDate.get(day) ?? null, existingFeesByDate.get(day) ?? null);
    return [{
      organization_id: store.organization_id, store_id: store.id, sales_date: day,
      gross_sales: numeric(row.gross_sales), discounts: numeric(row.discounts), sales_reversals: numeric(row.sales_reversals),
      net_sales: numeric(row.net_sales), shipping_charges: numeric(row.shipping_charges), taxes: numeric(row.taxes),
      total_sales: numeric(row.total_sales), orders: Math.max(0, Math.trunc(numeric(row.orders))),
      net_items_sold: Math.trunc(numeric(row.net_items_sold)), cost_of_goods_sold: numeric(row.cost_of_goods_sold),
      gross_profit: numeric(row.gross_profit), net_sales_with_cost_recorded: numeric(row.net_sales_with_cost_recorded),
      net_sales_without_cost_recorded: numeric(row.net_sales_without_cost_recorded),
      ...fee, currency: store.currency, synced_at: now,
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

function paymentQueryWindows(from: string, to: string) {
  const windows: Array<{ from: string; to: string }> = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const start = cursor.toISOString().slice(0, 10);
    const last = new Date(Math.min(cursor.getTime() + 59 * 86400000, end.getTime()));
    windows.push({ from: start, to: last.toISOString().slice(0, 10) });
    cursor = new Date(last.getTime() + 86400000);
  }
  return windows;
}

/** ShopifyQL supplies payment value and count by gateway, including historical orders
 * that predate our order-transaction importer. It does not supply provider fees. */
export async function refreshShopifyPaymentGateways(supabase: SupabaseClient, store: Store, from: string, to: string) {
  if (!store.shopify_domain) return;
  const { data: settings, error: settingsError } = await supabase.from("payment_fee_estimate_settings")
    .select("gateway_synced_from,gateway_synced_to,gateway_synced_at").eq("store_id", store.id).maybeSingle();
  if (settingsError) throw settingsError;
  if (settings?.gateway_synced_from && settings.gateway_synced_to && settings.gateway_synced_at &&
      settings.gateway_synced_from <= from && settings.gateway_synced_to >= to &&
      settings.gateway_synced_at >= freshAfter()) return;
  const token = await readSecret(supabase, store.id, "shopify");
  if (!token) return;
  const run = (query: string) => shopifyGraph<ShopifyQlResult>(store.shopify_domain!, token,
    `query Reporting($shopifyQl:String!){ shopifyqlQuery(query:$shopifyQl){ tableData{ rows } parseErrors } }`, { shopifyQl: query });
  const windows = paymentQueryWindows(from, to);
  const reportRows: ShopifyQlRow[] = [];
  for (let index = 0; index < windows.length; index += 3) {
    const reports = await Promise.all(windows.slice(index, index + 3).map(({ from: start, to: end }) => run(
      `FROM payments\nSHOW gross_payments, transactions\nWHERE transaction_kind IN ('sale', 'capture') AND transaction_status = 'success'\nGROUP BY payment_gateway\nTIMESERIES day\nSINCE ${start} UNTIL ${end}\nORDER BY day ASC\nLIMIT 1000`
    )));
    for (const report of reports) {
      if (report.shopifyqlQuery.parseErrors[0]) throw new Error(`Shopify payment report: ${report.shopifyqlQuery.parseErrors[0]}`);
      const rows = report.shopifyqlQuery.tableData?.rows ?? [];
      if (rows.length >= 1000) throw new Error("Shopify payment report exceeded its row limit; use shorter query windows");
      reportRows.push(...rows);
    }
  }
  const planResult = await shopifyGraph<{ shop: { plan: { publicDisplayName: string } } }>(
    store.shopify_domain, token, `query ShopPlan { shop { plan { publicDisplayName } } }`).catch(() => null);
  const now = new Date().toISOString();
  const rows = reportRows.flatMap((row) => {
    const date = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    const gateway = typeof row.payment_gateway === "string" ? row.payment_gateway.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !gateway) return [];
    return [{ organization_id: store.organization_id, store_id: store.id, payment_date: date,
      gateway, gross_payments: Math.max(0, numeric(row.gross_payments)),
      transactions: Math.max(0, Math.trunc(numeric(row.transactions))), currency: store.currency, synced_at: now }];
  });
  const { error: deleteError } = await supabase.from("shopify_payment_gateway_daily")
    .delete().eq("store_id", store.id).gte("payment_date", from).lte("payment_date", to);
  if (deleteError) throw deleteError;
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from("shopify_payment_gateway_daily").upsert(rows.slice(index, index + 500),
      { onConflict: "store_id,payment_date,gateway" });
    if (error) throw error;
  }
  const metadata = { ...(planResult ? { shopify_plan: planResult.shop.plan.publicDisplayName } : {}),
    gateway_synced_from: from, gateway_synced_to: to, gateway_synced_at: now, updated_at: now };
  const { error: saveError } = settings
    ? await supabase.from("payment_fee_estimate_settings").update(metadata).eq("store_id", store.id)
    : await supabase.from("payment_fee_estimate_settings").insert({ ...metadata, organization_id: store.organization_id, store_id: store.id });
  if (saveError) throw saveError;
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

function readZipText(zip: Buffer) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65558); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Microsoft Advertising returned an unreadable report archive");
  const count = zip.readUInt16LE(end + 10); let cursor = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = zip.readUInt16LE(cursor + 10), compressedSize = zip.readUInt32LE(cursor + 20), nameSize = zip.readUInt16LE(cursor + 28), extraSize = zip.readUInt16LE(cursor + 30), commentSize = zip.readUInt16LE(cursor + 32), localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameSize);
    if (/\.(csv|tsv)$/i.test(name)) {
      const localNameSize = zip.readUInt16LE(localOffset + 26), localExtraSize = zip.readUInt16LE(localOffset + 28), start = localOffset + 30 + localNameSize + localExtraSize;
      const content = zip.subarray(start, start + compressedSize);
      if (method === 0) return content.toString("utf8");
      if (method === 8) return inflateRawSync(content).toString("utf8");
      throw new Error("Microsoft Advertising returned an unsupported report format");
    }
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  throw new Error("Microsoft Advertising report archive contained no CSV data");
}

function parseDelimited(text: string) {
  const delimiter = text.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function refreshBing(supabase: SupabaseClient, store: Store, from: string, to: string) {
  // Microsoft only retains daily Campaign Performance data for 36 months.
  // "All imported data" can start much earlier (for example, old Shopify
  // orders), and submitting that entire range makes Microsoft reject the
  // report before it returns any of the dates that are still available.
  const retentionStart = new Date();
  retentionStart.setUTCDate(1);
  retentionStart.setUTCMonth(retentionStart.getUTCMonth() - 36);
  const earliestAvailableDate = retentionStart.toISOString().slice(0, 10);
  if (to < earliestAvailableDate) return;
  const reportFrom = from < earliestAvailableDate ? earliestAvailableDate : from;
  if (!await needsRefresh(supabase, "bing_ads_insights_daily", store.id, "insight_date", reportFrom, to)) return;
  const [{ data: connection }, secret, { data: account }] = await Promise.all([
    supabase.from("data_connections").select("external_account_id,external_account_name").eq("store_id", store.id).eq("provider", "bing_ads").eq("status", "connected").maybeSingle(),
    readSecret(supabase, store.id, "bing_ads"),
    supabase.from("bing_ads_accounts").select("account_id,customer_id,name,currency").eq("store_id", store.id).eq("is_selected", true).maybeSingle(),
  ]);
  if (!connection?.external_account_id) return;
  if (!secret) throw new Error("Microsoft Advertising connection has no saved authorization; reconnect the account");
  if (!account) throw new Error("Choose a Microsoft Advertising account in Connections");
  const clientId = process.env.MICROSOFT_ADS_CLIENT_ID?.trim(); const clientSecret = process.env.MICROSOFT_ADS_CLIENT_SECRET?.trim(); const developerToken = process.env.MICROSOFT_ADS_DEVELOPER_TOKEN?.trim();
  if (!clientId || !clientSecret || !developerToken) throw new Error("Microsoft Advertising reporting credentials are not configured on the server");
  let saved: { refreshToken: string; customerId: string };
  try { saved = JSON.parse(secret) as typeof saved; } catch { throw new Error("Microsoft Advertising saved token is invalid; reconnect the account"); }
  const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: saved.refreshToken, scope: "openid offline_access https://ads.microsoft.com/msads.manage" }), cache: "no-store" });
  const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description ?? "Microsoft Advertising authorization could not be refreshed");
  if (token.refresh_token) {
    const { error } = await supabase.rpc("rotate_bing_ads_secret", { requested_store_id: store.id, secret_payload: JSON.stringify({ refreshToken: token.refresh_token, customerId: saved.customerId }) });
    if (error) throw error;
  }
  const requestHeaders = { Authorization: `Bearer ${token.access_token}`, DeveloperToken: developerToken, CustomerAccountId: String(account.account_id), CustomerId: String(account.customer_id), "Content-Type": "application/json" };
  const dateParts = (value: string) => { const [year, month, day] = value.split("-").map(Number); return { Year: year, Month: month, Day: day }; };
  const submit = await fetch("https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit", { method: "POST", headers: requestHeaders, body: JSON.stringify({ ReportRequest: { Type: "CampaignPerformanceReportRequest", Aggregation: "Daily", Columns: ["TimePeriod", "Spend", "Impressions", "Clicks", "CurrencyCode"], Scope: { AccountIds: [String(account.account_id)] }, Time: { CustomDateRangeStart: dateParts(reportFrom), CustomDateRangeEnd: dateParts(to), ReportTimeZone: "GreenwichMeanTimeDublinEdinburghLisbonLondon" }, Format: "Csv", FormatVersion: "2.0", ReportName: `Spine spend ${reportFrom} ${to}`, ReturnOnlyCompleteData: false, ExcludeColumnHeaders: false, ExcludeReportHeader: true, ExcludeReportFooter: true } }), cache: "no-store" });
  const submitPayload = await submit.json().catch(() => ({})) as { ReportRequestId?: string; Errors?: Array<{ Message?: string }> };
  if (!submit.ok || !submitPayload.ReportRequestId) throw new Error(submitPayload.Errors?.[0]?.Message ?? "Microsoft Advertising did not accept the spend report");
  let downloadUrl = "";
  for (let poll = 0; poll < 20; poll++) {
    if (poll) await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await fetch("https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Poll", { method: "POST", headers: requestHeaders, body: JSON.stringify({ ReportRequestId: submitPayload.ReportRequestId }), cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { ReportRequestStatus?: { Status?: string; ReportDownloadUrl?: string }; Errors?: Array<{ Message?: string }> };
    if (!response.ok) throw new Error(payload.Errors?.[0]?.Message ?? "Microsoft Advertising report status could not be read");
    if (payload.ReportRequestStatus?.Status === "Success") {
      if (!payload.ReportRequestStatus.ReportDownloadUrl) throw new Error(`Microsoft Advertising returned no spend rows for ${reportFrom} to ${to}`);
      downloadUrl = payload.ReportRequestStatus.ReportDownloadUrl;
      break;
    }
    if (payload.ReportRequestStatus?.Status === "Error") throw new Error("Microsoft Advertising could not generate the spend report");
  }
  if (!downloadUrl) throw new Error("Microsoft Advertising spend report is still processing; it will retry on the next refresh");
  const reportResponse = await fetch(downloadUrl, { cache: "no-store" });
  if (!reportResponse.ok) throw new Error("Microsoft Advertising spend report could not be downloaded");
  const zip = Buffer.from(await reportResponse.arrayBuffer()); const rows = parseDelimited(readZipText(zip));
  const header = rows.shift()?.map((item) => item.trim().toLowerCase()) ?? [];
  const index = (name: string) => header.indexOf(name.toLowerCase());
  if (index("timeperiod") < 0 || index("spend") < 0) throw new Error("Microsoft Advertising report is missing its date or spend columns");
  const now = new Date().toISOString();
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number; currency: string }>();
  rows.forEach((row) => {
    const rawDate = (row[index("timeperiod")] ?? "").trim();
    const isoDate = rawDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const usDate = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const date = isoDate ? `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}` : usDate ? `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}` : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const daily = byDate.get(date) ?? { spend: 0, impressions: 0, clicks: 0, currency: row[index("currencycode")] || account.currency || store.currency };
    daily.spend += numeric(row[index("spend")]);
    daily.impressions += Math.round(numeric(row[index("impressions")]));
    daily.clicks += Math.round(numeric(row[index("clicks")]));
    byDate.set(date, daily);
  });
  const imported = [...byDate].map(([insight_date, daily]) => ({ organization_id: store.organization_id, store_id: store.id, account_id: String(account.account_id), account_name: account.name, insight_date, ...daily, synced_at: now }));
  if (!imported.length) throw new Error(`Microsoft Advertising returned no dated spend rows for ${reportFrom} to ${to}`);
  const { error } = await supabase.from("bing_ads_insights_daily").upsert(imported, { onConflict: "store_id,account_id,insight_date" });
  if (error) throw error;
  return imported.length;
}

export async function refreshMicrosoftAdsReporting(supabase: SupabaseClient, store: Store, from: string, to: string) {
  try {
    const imported = await refreshBing(supabase, store, from, to);
    if (imported) await supabase.from("data_connections").update({ last_error: null }).eq("store_id", store.id).eq("provider", "bing_ads");
  } catch (error) {
    const message = error instanceof Error ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
      : "Microsoft Advertising spend could not be imported";
    await supabase.from("data_connections").update({ last_error: message }).eq("store_id", store.id).eq("provider", "bing_ads");
    throw error;
  }
}

export type ReportingSourceResult = { source: string; status: "fulfilled" | "rejected"; message?: string };

export async function refreshReportingData(_supabase: SupabaseClient, store: Store, from: string, to: string): Promise<ReportingSourceResult[]> {
  const reportingClient = createAdminClient();
  const sources = ["shopify", "shopify_payments", "meta", "google_ads", "bing_ads"];
  const results = await Promise.allSettled([
    refreshShopifyReporting(reportingClient, store, from, to),
    refreshShopifyPaymentGateways(reportingClient, store, from, to),
    refreshMeta(reportingClient, store, from, to),
    refreshGoogle(reportingClient, store, from, to),
    refreshMicrosoftAdsReporting(reportingClient, store, from, to),
  ]);
  return results.map((result, index) => {
    if (result.status === "rejected") {
      const message = result.reason instanceof Error ? result.reason.message : "Unknown error";
      console.error("Reporting refresh failed", { source: sources[index], message });
      return { source: sources[index], status: "rejected" as const, message };
    }
    return { source: sources[index], status: "fulfilled" as const };
  });
}


