import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
export async function GET() {
  const w = await requireWorkspace(); if (!w.ok) return w.response; if (!w.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  const { data, error } = await w.supabase.from("bing_ads_accounts").select("account_id,customer_id,name,account_number,currency,status,is_selected").eq("store_id", w.store.id).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ accounts: data ?? [] });
}
export async function POST(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response; if (!w.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { accountId?: string } | null; const accountId = body?.accountId?.trim();
  if (!accountId) return NextResponse.json({ error: "Choose a Microsoft Advertising account" }, { status: 400 });
  const { data, error } = await w.supabase.rpc("select_bing_ads_connection", { requested_store_id: w.store.id, selected_account_id: accountId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ connection: Array.isArray(data) ? data[0] : data });
}

