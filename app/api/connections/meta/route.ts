import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

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

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return { supabase, userId: null, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }

  return { supabase, userId: data.claims.sub, response: null };
}

async function importMetaInsights({ supabase, userId, account, accessToken }: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; account: MetaAccount; accessToken: string }) {
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (membershipError || !membership) throw new Error("No workspace is configured");
  const { data: store, error: storeError } = await supabase
    .from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (storeError || !store) throw new Error("No store is configured");

  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 1094);
  const range = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  const params = new URLSearchParams({
    level: "account",
    time_increment: "1",
    fields: "account_id,account_name,date_start,date_stop,spend,impressions,clicks",
    time_range: JSON.stringify(range),
    limit: "1000",
  });
  let next: string | undefined = `https://graph.facebook.com/v22.0/${encodeURIComponent(account.id)}/insights?${params}`;
  const insights: MetaInsight[] = [];
  for (let page = 0; next && page < 8; page += 1) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as MetaPage;
    if (!response.ok) throw new Error(payload.error?.message ?? "Meta could not import ad-account insights");
    insights.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  if (next) throw new Error("Meta returned more reporting pages than Spine can safely import in one run. Please narrow the account history and try again.");

  const rows = insights
    .filter((insight) => insight.date_start && insight.date_stop)
    .map((insight) => ({
      organization_id: membership.organization_id,
      store_id: store.id,
      account_id: insight.account_id ?? account.id,
      account_name: insight.account_name ?? account.name ?? null,
      date_start: insight.date_start!,
      date_stop: insight.date_stop!,
      spend: numeric(insight.spend),
      impressions: Math.round(numeric(insight.impressions)),
      clicks: Math.round(numeric(insight.clicks)),
      currency: account.currency ?? store.currency,
      synced_at: new Date().toISOString(),
    }));
  for (let start = 0; start < rows.length; start += 250) {
    const { error } = await supabase.from("meta_ad_insights_daily").upsert(rows.slice(start, start + 250), { onConflict: "store_id,account_id,date_start" });
    if (error) throw new Error(error.message);
  }
  return { importedDays: rows.length, range, currency: account.currency ?? store.currency };
}

export async function GET() {
  const { supabase, response } = await requireUser();
  if (response) return response;

  const { data, error } = await supabase
    .from("data_connections")
    .select("provider,status,external_account_id,external_account_name,last_verified_at,last_error")
    .eq("provider", "meta")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}

export async function POST(request: Request) {
  const { supabase, userId, response } = await requireUser();
  if (response || !userId) return response!;

  const body = await request.json().catch(() => null) as { accessToken?: string; accountId?: string } | null;
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
    connection_provider: "meta", access_token: accessToken, account_id: account.id, account_name: account.name ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const sync = await importMetaInsights({ supabase, userId, account, accessToken });
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
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { error } = await supabase.rpc("delete_data_connection", { connection_provider: "meta" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
