import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStockPage } from "@/lib/shopify/stock";
export const maxDuration = 300;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const workspace = await requireWorkspace({ storeId: params.get("storeId"), strict: true });
  if (!workspace.ok) return workspace.response;
  const { store, supabase } = workspace;
  if (!store?.shopify_domain || store.business_model !== "ecommerce") return NextResponse.json({ error: "Connect Shopify to use stock planning." }, { status: 400 });
  try {
    if (params.get("part") === "demand") {
      const asOf = new Date().toISOString();
      const [demand, sync] = await Promise.all([
        supabase.rpc("stock_demand", { requested_store_id: store.id, as_of: asOf }),
        supabase.from("sync_runs").select("status,warnings,updated_at,completed_at").eq("store_id", store.id).eq("source", "shopify").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (demand.error || sync.error) throw new Error(demand.error?.message ?? sync.error?.message);
      return NextResponse.json({ demand: demand.data, sync: sync.data, asOf, storeName: store.name, currency: store.currency, canManage: ["owner", "admin"].includes(workspace.membership.role) });
    }
    const { data: token, error } = await createAdminClient().rpc("read_connection_secret_for_server", { requested_store_id: store.id, connection_provider: "shopify" });
    if (error || typeof token !== "string" || !token) return NextResponse.json({ error: "Reconnect Shopify in Connections to load stock." }, { status: 400 });
    const result = await loadStockPage(store.shopify_domain, token, params.get("cursor"));
    return NextResponse.json({ ...result, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock could not be loaded";
    return NextResponse.json({ error: /access|scope|permission/i.test(message) ? "Shopify needs read_inventory, read_products and read_locations access. Update the Shopify app permissions and reconnect in Connections." : message }, { status: 502 });
  }
}
