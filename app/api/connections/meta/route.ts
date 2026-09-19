import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireWorkspace } from "@/lib/workspace/server";

type MetaAccount = {
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

type MetaPage = { data?: MetaInsight[]; paging?: { next?: string }; error?: { message?: string } };

const numeric = (value: string | undefined) => {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { response: workspace.response };
  if (!workspace.store) {
    return { response: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  }
  return { ...workspace, response: null };
}

async function importMetaInsights({ supabase, organizationId, store, account, accessToken, lookbackMonths }: { supabase: SupabaseClient; organizationId: string; store: { id: string; currency: string }; account: MetaAccount; accessToken: string; lookbackMonths: number }) {

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
  let next: string | undefined = `https://graph.facebook.com/v22.0/${encodeURIComponent(account.id)}/insights?${params}`;
  const insights: MetaInsight[] = [];
  for (let page = 0; next && page < 12; page += 1) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as MetaPage;
    if (!response.ok) throw new Error(payload.error?.message ?? "Meta could not import ad-account insights");
    insights.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  if (next) throw new Error("Meta returned more reporting pages than Spine can safely import in one run. Please reconnect with a token limited to the reporting period you need.");

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
    } else accountDays.set(key, { ...row });
  }
  const rows = [...accountDays.values()].map((row) => ({ organization_id: row.organization_id, store_id: row.store_id, account_id: row.account_id, account_name: row.account_name, date_start: row.date_start, date_stop: row.date_stop, spend: row.spend, impressions: row.impressions, clicks: row.clicks, currency: row.currency, synced_at: row.synced_at }));
  for (let start = 0; start < campaignRows.length; start += 250) {
    const { error } = await supabase.from("meta_campaign_insights_daily").upsert(campaignRows.slice(start, start + 250), { onConflict: "store_id,account_id,campaign_id,date_start" });
    if (error) throw new Error(error.message);
  }
  for (let start = 0; start < rows.length; start += 250) {
    const { error } = await supabase.from("meta_ad_insights_daily").upsert(rows.slice(start, start + 250), { onConflict: "store_id,account_id,date_start" });
    if (error) throw new Error(error.message);
  }
  return { importedDays: rows.length, importedCampaignDays: campaignRows.length, range, currency: account.currency ?? store.currency };
}

export async function GET() {
  const result = await context();
  if (result.response) return result.response;
  const { supabase, store } = result;

  const { data, error } = await supabase
    .from("data_connections")
    .select("provider,status,external_account_id,external_account_name,last_verified_at,last_error")
    .eq("store_id", store.id)
    .eq("provider", "meta")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sync = null;
  if (data) {
    const [{ data: latest, count }, { count: campaignDays }] = await Promise.all([
      supabase.from("meta_ad_insights_daily").select("date_start,synced_at", { count: "exact" }).eq("store_id", store.id).order("date_start", { ascending: false }).limit(1),
      supabase.from("meta_campaign_insights_daily").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    ]);
    sync = { importedDays: count ?? 0, importedCampaignDays: campaignDays ?? 0, latestDate: latest?.[0]?.date_start ?? null, syncedAt: latest?.[0]?.synced_at ?? null };
  }
  return NextResponse.json({ connection: data, sync });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.response) return result.response;
  const { supabase, membership, store } = result;

  const body = await request.json().catch(() => null) as { accessToken?: string; accountId?: string; lookbackMonths?: number } | null;
  const requestedLookback = Number(body?.lookbackMonths);
  const lookbackMonths = Number.isInteger(requestedLookback) && requestedLookback >= 1 && requestedLookback <= 36 ? requestedLookback : 36;
  const accessToken = body?.accessToken?.trim();
  if (!accessToken) return NextResponse.json({ error: "Access token is required to import Meta spend" }, { status: 400 });

  const accountsResponse = await fetch(
    "https://graph.facebook.com/v22.0/me/adaccounts?fields=id,name,account_status,currency,timezone_name&limit=100",
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  const accountsPayload = await accountsResponse.json().catch(() => ({})) as { data?: MetaAccount[]; error?: { message?: string } };
  if (!accountsResponse.ok) {
    return NextResponse.json({ error: accountsPayload.error?.message ?? "Meta rejected this access token" }, { status: 400 });
  }

  const requestedId = body?.accountId?.trim().replace(/^act_/, "");
  const account = requestedId
    ? accountsPayload.data?.find((item) => item.id.replace(/^act_/, "") === requestedId)
    : accountsPayload.data?.[0];
  if (!account) return NextResponse.json({ error: requestedId ? "That ad account is not available to this token" : "No ad accounts were found for this token" }, { status: 400 });

  const { data, error } = await supabase.rpc("save_data_connection", {
    connection_provider: "meta", requested_store_id: store.id, access_token: accessToken, account_id: account.id, account_name: account.name ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const sync = await importMetaInsights({ supabase, organizationId: membership.organizationId, store, account, accessToken, lookbackMonths });
    const saved = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      connection: { provider: saved?.provider ?? "meta", status: saved?.status ?? "connected", external_account_id: account.id, external_account_name: account.name ?? account.id, last_verified_at: saved?.last_verified_at ?? new Date().toISOString() },
      sync,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Meta connection saved but spend could not be imported";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const result = await context();
  if (result.response) return result.response;
  const { supabase, store } = result;
  const { error } = await supabase.rpc("delete_data_connection", { connection_provider: "meta", requested_store_id: store.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
