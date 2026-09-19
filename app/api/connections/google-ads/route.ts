import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { response: workspace.response };
  if (!workspace.store) return { response: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  const { supabase, membership, store } = workspace;
  return { supabase, membership, store, response: null };
}

export async function GET() {
  const result = await context();
  if (result.response) return result.response;
  const { data, error } = await result.supabase
    .from("data_connections")
    .select("provider,status,external_account_id,external_account_name,last_verified_at,last_error")
    .eq("store_id", result.store.id)
    .eq("provider", "google_ads")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}

export async function DELETE() {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin"].includes(result.membership.role)) {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }
  const { error } = await result.supabase.rpc("delete_data_connection", {
    connection_provider: "google_ads",
    requested_store_id: result.store.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
