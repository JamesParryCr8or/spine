import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

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
  const { data, error } = await result.supabase
    .from("data_connections")
    .select("provider,status,external_account_id,external_account_name,last_verified_at,last_error")
    .eq("store_id", result.store.id)
    .eq("provider", "klaviyo")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin", "connector"].includes(result.membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }

  const { apiKey } = await request.json().catch(() => ({})) as { apiKey?: string };
  const key = apiKey?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "A Klaviyo private API key is required" },
      { status: 400 },
    );
  }

  const verified = await fetch("https://a.klaviyo.com/api/accounts/", {
    headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: "2025-01-15" },
    cache: "no-store",
  });
  const payload = await verified.json().catch(() => ({})) as {
    data?: Array<{
      id: string;
      attributes?: { contact_information?: { organization_name?: string } };
    }>;
    errors?: Array<{ detail?: string }>;
  };
  if (!verified.ok) {
    return NextResponse.json(
      { error: payload.errors?.[0]?.detail ?? "Klaviyo rejected this private API key" },
      { status: 400 },
    );
  }
  const account = payload.data?.[0];
  if (!account) {
    return NextResponse.json(
      { error: "No Klaviyo account was returned for this key" },
      { status: 400 },
    );
  }

  const { data, error } = await result.supabase.rpc("save_data_connection", {
    connection_provider: "klaviyo",
    requested_store_id: result.store.id,
    access_token: key,
    account_id: account.id,
    account_name:
      account.attributes?.contact_information?.organization_name ?? account.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: Array.isArray(data) ? data[0] : data });
}

export async function DELETE() {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin", "connector"].includes(result.membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }
  const { error } = await result.supabase.rpc("delete_data_connection", {
    connection_provider: "klaviyo",
    requested_store_id: result.store.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
