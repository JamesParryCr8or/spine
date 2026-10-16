import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStockPage } from "@/lib/shopify/stock";
import { runStoreShopifyQl } from "@/lib/shopify/shopifyql";
import { buildStockDemand, demandPageSize, demandWindows, stockDemandDates, stockDemandQuery } from "@/lib/stock/demand";
import type { ShopifyQlRow } from "@/lib/analytics/campaign-rows";
export const maxDuration = 300;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const workspace = await requireWorkspace({ storeId: params.get("storeId"), strict: true });
  if (!workspace.ok) return workspace.response;
  const { store } = workspace;
  if (!store?.shopify_domain || store.business_model !== "ecommerce") return NextResponse.json({ error: "Connect Shopify to use stock planning." }, { status: 400 });
  try {
    if (params.get("part") === "demand") {
      const asOf = new Date().toISOString();
      const dates = stockDemandDates(store.timezone || "UTC");
      const results: Record<30 | 60 | 90, ShopifyQlRow[]> = { 30: [], 60: [], 90: [] };
      await Promise.all(demandWindows.map(async (days) => {
        const seenPages = new Set<string>();
        for (let offset = 0; ; offset += demandPageSize) {
          const result = await runStoreShopifyQl(store, { demand: stockDemandQuery(dates.from[days], dates.through, offset) });
          if (!result.ok) throw new Error(result.error);
          const rows = result.results.demand;
          if (rows.length) {
            const signature = JSON.stringify(rows.map((row) => row.product_variant_id));
            if (seenPages.has(signature)) throw new Error("Shopify repeated a demand page. Refresh to retry.");
            seenPages.add(signature);
            results[days].push(...rows);
          }
          if (rows.length < demandPageSize) break;
        }
      }));
      return NextResponse.json({ demand: buildStockDemand(results), through: dates.through, source: "shopifyql", asOf, storeName: store.name, currency: store.currency, canManage: ["owner", "admin"].includes(workspace.membership.role) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const { data: token, error } = await createAdminClient().rpc("read_connection_secret_for_server", { requested_store_id: store.id, connection_provider: "shopify" });
    if (error || typeof token !== "string" || !token) return NextResponse.json({ error: "Reconnect Shopify in Connections to load stock." }, { status: 400 });
    const result = await loadStockPage(store.shopify_domain, token, params.get("cursor"));
    return NextResponse.json({ ...result, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock could not be loaded";
    return NextResponse.json({ error: /access|scope|permission/i.test(message) ? `Shopify needs ${params.get("part") === "demand" ? "read_reports" : "read_inventory, read_products and read_locations"} access. Update the Shopify app permissions and reconnect in Connections.` : message }, { status: 502 });
  }
}
