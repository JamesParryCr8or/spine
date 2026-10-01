import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
export async function GET() {
  const w = await requireWorkspace(); if (!w.ok) return w.response; if (!w.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const { data, error } = await w.supabase.from("data_connections").select("provider,status,external_account_id,external_account_name,last_verified_at,last_error").eq("store_id", w.store.id).eq("provider", "bing_ads").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ connection: data });
}
export async function DELETE() {
  const w = await requireWorkspace(); if (!w.ok) return w.response; if (!w.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const { error } = await w.supabase.rpc("delete_data_connection", { connection_provider: "bing_ads", requested_store_id: w.store.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ success: true });
}

