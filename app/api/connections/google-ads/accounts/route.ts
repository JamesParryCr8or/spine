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
    .from("google_ads_accounts")
    .select("customer_id,name,is_manager,hierarchy_level,direct_access")
    .eq("store_id", result.store.id)
    .order("direct_access", { ascending: false })
    .order("is_manager", { ascending: false })
    .order("hierarchy_level")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [], canManage: ["owner", "admin", "connector"].includes(result.membership.role) });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.response) return result.response;
  if (!["owner", "admin", "connector"].includes(result.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { customerId?: string } | null;
  const customerId = body?.customerId?.replace(/\D/g, "") ?? "";
  if (!customerId) return NextResponse.json({ error: "Choose a Google Ads account" }, { status: 400 });
  const { data, error } = await result.supabase.rpc("select_google_ads_connection", { requested_store_id: result.store.id, selected_customer_id: customerId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: Array.isArray(data) ? data[0] : data });
}
