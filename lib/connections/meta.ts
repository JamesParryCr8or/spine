import type { SupabaseClient } from "@supabase/supabase-js";

export type MetaAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
};

type MetaInsight = {
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
};

type MetaPage = {
  data?: MetaInsight[];
  paging?: { next?: string };
  error?: { message?: string };
};

const graphVersion = "v22.0";

const numeric = (value: string | undefined) => {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

class MetaAccountDiscoveryError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) { super(message); this.code = code; }
}

async function metaAccountEdge(accessToken: string, edge: "adaccounts" | "assigned_ad_accounts", includeAllPages: boolean, nodeId = "me") {
  const accounts: MetaAccount[] = [];
  let next: string | undefined = `https://graph.facebook.com/${graphVersion}/${nodeId}/${edge}?fields=id,name,account_status,currency,timezone_name&limit=100`;
  for (let page = 0; next && page < (includeAllPages ? 10 : 1); page++) {
    const url = new URL(next);
    if (url.origin !== "https://graph.facebook.com") throw new Error("Meta returned an unexpected pagination URL");
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { data?: MetaAccount[]; paging?: { next?: string }; error?: { message?: string; code?: number } };
    if (!response.ok || payload.error) throw new MetaAccountDiscoveryError(payload.error?.message ?? "Meta rejected this connection", payload.error?.code);
    accounts.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  if (includeAllPages && next) throw new Error("Meta returned more than 1,000 ad accounts. Narrow the assets approved for Spine and try again.");
  return accounts;
}

type MetaTokenGrant = {
  app_id?: string; is_valid?: boolean; user_id?: string; type?: string;
  scopes?: string[]; granular_scopes?: { scope?: string; target_ids?: string[] }[];
};

async function metaTokenGrant(accessToken: string): Promise<MetaTokenGrant | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return null;
  const url = new URL(`https://graph.facebook.com/${graphVersion}/debug_token`);
  url.searchParams.set("input_token", accessToken);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${appId}|${appSecret}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as { data?: MetaTokenGrant; error?: { code?: number } };
  if (!response.ok || !payload.data) throw new Error("Meta could not inspect the business sign-in. Sign in with Meta again.");
  if (!payload.data.is_valid) throw new Error("Meta sign-in has expired or was revoked. Sign in with Meta again.");
  if (payload.data.app_id !== appId) throw new Error("This Meta token belongs to a different app. Use Connect with Meta to authorize Spine.");
  return payload.data;
}

async function grantedMetaAccounts(accessToken: string, grant: MetaTokenGrant, includeAllPages: boolean) {
  if (grant.scopes && !grant.scopes.some(scope => scope === "ads_read" || scope === "ads_management")) {
    throw new Error("Meta did not grant ads_read. Add it to the login configuration, then sign in with Meta again.");
  }
  const ids = [...new Set((grant.granular_scopes ?? [])
    .filter(scope => scope.scope === "ads_read" || scope.scope === "ads_management")
    .flatMap(scope => scope.target_ids ?? []).filter(id => /^(act_)?[0-9]+$/.test(id)))];
  // Operational evidence for this flow without recording credentials or asset IDs.
  console.info({ event: "meta_business_account_discovery", tokenType: grant.type ?? "unknown",
    grantedAccountCount: ids.length, hasSystemUser: Boolean(grant.user_id) });
  if (!ids.length) {
    if (!grant.user_id || !/^[0-9]+$/.test(grant.user_id)) {
      throw new Error("Meta returned no ad account grants or system-user identity. Sign in again and approve at least one ad account.");
    }
    return metaAccountEdge(accessToken, "assigned_ad_accounts", includeAllPages, grant.user_id);
  }
  if (ids.length > 1000) throw new Error("Meta returned more than 1,000 approved accounts. Narrow the approved assets and try again.");
  const accounts: MetaAccount[] = [];
  // Request only IDs in this token's ad permissions, never all business assets.
  for (let start = 0; start < ids.length; start += 5) {
    accounts.push(...await Promise.all(ids.slice(start, start + 5).map(async id => {
      const accountId = id.startsWith("act_") ? id : `act_${id}`;
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${accountId}?fields=id,name,account_status,currency,timezone_name`, {
        headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({})) as MetaAccount & { error?: { message?: string; code?: number } };
      if (!response.ok || payload.error || !payload.id) throw new MetaAccountDiscoveryError(payload.error?.message ?? "Meta could not load an approved ad account", payload.error?.code);
      return { id: payload.id, name: payload.name, currency: payload.currency, account_status: payload.account_status, timezone_name: payload.timezone_name };
    })));
  }
  return accounts;
}

export async function discoverMetaAccounts(accessToken: string, includeAllPages = false) {
  let userError: MetaAccountDiscoveryError | undefined;
  try {
    const accounts = await metaAccountEdge(accessToken, "adaccounts", includeAllPages);
    if (accounts.length) return accounts;
  } catch (error) {
    // Personal-user and business system-user tokens expose different edges.
    // Invalid/revoked tokens and network errors must still fail immediately.
    if (!(error instanceof MetaAccountDiscoveryError) || ![10, 100, 200].includes(error.code ?? 0)) throw error;
    userError = error;
  }
  try {
    // Business tokens can reject the me alias entirely. Resolve their granted
    // assets or explicit system-user ID with the issuing app, on the server.
    if (userError) {
      const grant = await metaTokenGrant(accessToken);
      if (grant) return await grantedMetaAccounts(accessToken, grant, includeAllPages);
    }
    return await metaAccountEdge(accessToken, "assigned_ad_accounts", includeAllPages);
  } catch (error) {
    if (!userError && error instanceof MetaAccountDiscoveryError && [10, 100, 200].includes(error.code ?? 0)) return [];
    if (error instanceof MetaAccountDiscoveryError && [10, 200].includes(error.code ?? 0)) {
      throw new Error("Meta denied access to the approved ad accounts. Check that the login configuration includes ads_read and that the selected accounts grant ANALYZE access, then sign in with Meta again.");
    }
    throw error;
  }
}

export async function importMetaInsights({
  supabase,
  organizationId,
  store,
  account,
  accessToken,
  lookbackMonths,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  store: { id: string; currency: string };
  account: MetaAccount;
  accessToken: string;
  lookbackMonths: number;
}) {
  const until = new Date();
  const since = new Date(until);
  since.setUTCMonth(since.getUTCMonth() - lookbackMonths);
  const range = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    fields: "account_id,account_name,campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks",
    time_range: JSON.stringify(range),
    limit: "1000",
  });
  let next: string | undefined = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.id)}/insights?${params}`;
  const insights: MetaInsight[] = [];

  for (let page = 0; next && page < 12; page += 1) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as MetaPage;
    if (!response.ok) throw new Error(payload.error?.message ?? "Meta could not import ad-account insights");
    insights.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  if (next) throw new Error("Meta returned more reporting pages than Spine can safely import in one run. Reconnect with a shorter reporting period.");

  const campaignRows = insights
    .filter((insight) => insight.date_start && insight.date_stop && insight.campaign_id && insight.campaign_name)
    .map((insight) => ({
      organization_id: organizationId,
      store_id: store.id,
      account_id: insight.account_id ?? account.id,
      account_name: insight.account_name ?? account.name ?? null,
      campaign_id: insight.campaign_id!,
      campaign_name: insight.campaign_name!,
      date_start: insight.date_start!,
      date_stop: insight.date_stop!,
      spend: numeric(insight.spend),
      impressions: Math.round(numeric(insight.impressions)),
      clicks: Math.round(numeric(insight.clicks)),
      currency: account.currency ?? store.currency,
      synced_at: new Date().toISOString(),
    }));

  const accountDays = new Map<string, (typeof campaignRows)[number]>();
  for (const row of campaignRows) {
    const key = `${row.account_id}\u0000${row.date_start}`;
    const current = accountDays.get(key);
    if (current) {
      current.spend += row.spend;
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      if (row.date_stop > current.date_stop) current.date_stop = row.date_stop;
    } else {
      accountDays.set(key, { ...row });
    }
  }

  const dailyRows = [...accountDays.values()].map((row) => ({
    organization_id: row.organization_id,
    store_id: row.store_id,
    account_id: row.account_id,
    account_name: row.account_name,
    date_start: row.date_start,
    date_stop: row.date_stop,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    currency: row.currency,
    synced_at: row.synced_at,
  }));

  for (let start = 0; start < campaignRows.length; start += 250) {
    const { error } = await supabase
      .from("meta_campaign_insights_daily")
      .upsert(campaignRows.slice(start, start + 250), { onConflict: "store_id,account_id,campaign_id,date_start" });
    if (error) throw new Error(error.message);
  }
  for (let start = 0; start < dailyRows.length; start += 250) {
    const { error } = await supabase
      .from("meta_ad_insights_daily")
      .upsert(dailyRows.slice(start, start + 250), { onConflict: "store_id,account_id,date_start" });
    if (error) throw new Error(error.message);
  }

  return {
    importedDays: dailyRows.length,
    importedCampaignDays: campaignRows.length,
    range,
    currency: account.currency ?? store.currency,
  };
}
