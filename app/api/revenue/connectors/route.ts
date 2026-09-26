import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { isRevenueProvider } from "@/lib/revenue/oauth";
import { oauthConfig } from "@/lib/revenue/server";

export async function GET() {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store) return NextResponse.json({ error: "Choose a store" }, { status: 404 });
  const [connections, settings] = await Promise.all([
    w.supabase.from("data_connections").select("provider,external_account_name,status,last_error").eq("store_id", w.store.id).in("provider", ["stripe", "google_sheets"]),
    w.supabase.from("revenue_connector_settings").select("provider,settings,last_synced_at,last_error").eq("store_id", w.store.id),
  ]);
  if (connections.error || settings.error) return NextResponse.json({ error: "Revenue connectors are not ready. Apply the revenue database migration." }, { status: 503 });
  return NextResponse.json({ storeId: w.store.id, connections: connections.data, settings: settings.data, configured: { stripe: oauthConfig("stripe").configured, google_sheets: oauthConfig("google_sheets").configured }, canEdit: ["owner", "admin"].includes(w.membership.role) });
}
export async function DELETE(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store || !["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const provider = new URL(request.url).searchParams.get("provider") || "";
  if (!isRevenueProvider(provider)) return NextResponse.json({ error: "Unknown connector" }, { status: 400 });
  const { error } = await w.supabase.rpc("delete_data_connection", { connection_provider: provider, requested_store_id: w.store.id });
  if (error) return NextResponse.json({ error: "Could not disconnect" }, { status: 500 });
  await w.supabase.from("revenue_connector_settings").delete().eq("store_id", w.store.id).eq("provider", provider);
  return NextResponse.json({ disconnected: true });
}
