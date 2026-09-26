import { NextResponse } from "next/server";

import { discoverMetaAccounts, importMetaInsights } from "@/lib/connections/meta";
import { requireWorkspace } from "@/lib/workspace/server";
import { canManageConnections } from "@/lib/workspace/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { response: workspace.response };
  const store = workspace.store;
  if (!store) {
    return { response: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  }
  return { ...workspace, store, response: null };
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

  let connection = data;
  if (connection?.status === "connected") {
    const { data: accessToken, error: secretError } = await supabase.rpc("read_connection_secret", {
      requested_store_id: store.id,
      connection_provider: "meta",
    });
    if (!secretError && accessToken) {
      try {
        await discoverMetaAccounts(accessToken);
      } catch (cause) {
        const providerMessage = cause instanceof Error ? cause.message : "Meta rejected this connection";
        const needsReconnect = /(access token|oauth).*(expired|invalid|revoked)|(expired|invalid|revoked).*(access token|oauth)|code\s*190/i.test(providerMessage);
        const message = needsReconnect
          ? "Meta access token has expired or was revoked. Reconnect Facebook to continue importing spend."
          : `Meta connection needs attention: ${providerMessage}`;
        const { data: updated } = await supabase.rpc("mark_connection_error", {
          connection_provider: "meta",
          requested_store_id: store.id,
          connection_error: message,
        });
        connection = updated
          ? { ...connection, ...(Array.isArray(updated) ? updated[0] : updated) }
          : { ...connection, status: "error", last_error: message };
      }
    }
  }

  let sync = null;
  if (connection) {
    const [{ data: latest, count }, { count: campaignDays }] = await Promise.all([
      supabase.from("meta_ad_insights_daily").select("date_start,synced_at", { count: "exact" }).eq("store_id", store.id).order("date_start", { ascending: false }).limit(1),
      supabase.from("meta_campaign_insights_daily").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    ]);
    sync = {
      importedDays: count ?? 0,
      importedCampaignDays: campaignDays ?? 0,
      latestDate: latest?.[0]?.date_start ?? null,
      syncedAt: latest?.[0]?.synced_at ?? null,
    };
  }
  return NextResponse.json({ connection, sync });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.response) return result.response;
  if (!canManageConnections(result.membership.role)) return NextResponse.json({ error: "Connection management access is required" }, { status: 403 });
  const { supabase, membership, store } = result;

  const body = await request.json().catch(() => null) as { accessToken?: string; accountId?: string; lookbackMonths?: number } | null;
  const requestedLookback = Number(body?.lookbackMonths);
  const lookbackMonths = Number.isInteger(requestedLookback) && requestedLookback >= 1 && requestedLookback <= 36 ? requestedLookback : 36;
  const accessToken = body?.accessToken?.trim();
  if (!accessToken) return NextResponse.json({ error: "Access token is required to import Meta spend" }, { status: 400 });

  let accounts;
  try {
    accounts = await discoverMetaAccounts(accessToken);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Meta rejected this access token" }, { status: 400 });
  }

  const requestedId = body?.accountId?.trim().replace(/^act_/, "");
  const account = requestedId
    ? accounts.find((item) => item.id.replace(/^act_/, "") === requestedId)
    : accounts[0];
  if (!account) return NextResponse.json({ error: requestedId ? "That ad account is not available to this token" : "No ad accounts were found for this token" }, { status: 400 });

  const { data, error } = await supabase.rpc("save_data_connection", {
    connection_provider: "meta",
    requested_store_id: store.id,
    access_token: accessToken,
    account_id: account.id,
    account_name: account.name ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const sync = await importMetaInsights({ supabase: membership.role === "connector" ? createAdminClient() : supabase, organizationId: membership.organizationId, store, account, accessToken, lookbackMonths });
    const saved = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      connection: {
        provider: saved?.provider ?? "meta",
        status: saved?.status ?? "connected",
        external_account_id: account.id,
        external_account_name: account.name ?? account.id,
        last_verified_at: saved?.last_verified_at ?? new Date().toISOString(),
      },
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
  if (!canManageConnections(result.membership.role)) return NextResponse.json({ error: "Connection management access is required" }, { status: 403 });
  const { supabase, store } = result;
  const { error } = await supabase.rpc("delete_data_connection", { connection_provider: "meta", requested_store_id: store.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
