import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyGraph } from "./graphql";
import { runStoreShopifyQl } from "./shopifyql";
import { reportingDateKey } from "@/lib/analytics/reporting-range";
import type { WarehouseActivity } from "@/lib/analytics/warehouse-costs";

type Store = { id: string; shopify_domain?: string | null; timezone?: string | null };
export const warehouseLocationsQuery = `query WarehouseLocations($cursor: String) {
  locations(first: 100, after: $cursor, includeInactive: true) {
    nodes { id name isActive } pageInfo { hasNextPage endCursor }
  }
}`;
export const warehouseOrdersQuery = `query WarehouseOrders($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Order { id test fulfillments {
    id createdAt status totalQuantity location { id name }
  } } }
}`;
async function credentials(store: Store) {
  if (!store.shopify_domain) throw new Error("Connect Shopify to load warehouses");
  const { data, error } = await createAdminClient().rpc("read_connection_secret_for_server", { requested_store_id: store.id, connection_provider: "shopify" });
  if (error || typeof data !== "string" || !data) throw new Error("Reconnect Shopify to load warehouse activity");
  return { shop: store.shopify_domain, token: data };
}
export async function loadWarehouseLocations(store: Store) {
  const { shop, token } = await credentials(store);
  const locations: Array<{ id: string; name: string; isActive: boolean }> = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  while (true) {
    const data: { locations: { nodes: typeof locations; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraph(shop, token, warehouseLocationsQuery, { cursor });
    locations.push(...data.locations.nodes);
    if (!data.locations.pageInfo.hasNextPage) return locations;
    cursor = data.locations.pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) throw new Error("Incomplete Shopify warehouse list; retry loading");
    seen.add(cursor);
  }
}
type Order = { id: string; test: boolean; fulfillments: Array<{ id: string; createdAt: string; status: string; totalQuantity: number; location: { id: string; name: string } | null }> };
async function fetchWarehouseActivity(store: Store, from: string, to: string): Promise<WarehouseActivity[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    if (offset >= 1000000) throw new Error("Warehouse report is too large; choose a shorter period");
    const result = await runStoreShopifyQl({ id: store.id, shopify_domain: store.shopify_domain ?? null }, {
      warehouses: `FROM fulfillments SHOW orders_fulfilled GROUP BY order_id HAVING orders_fulfilled > 0 SINCE ${from} UNTIL ${to} ORDER BY order_id ASC LIMIT 1000 OFFSET ${offset}`,
    });
    if (!result.ok) throw new Error(`Warehouse quantities could not be loaded: ${result.error}`);
    for (const row of result.results.warehouses) {
      const raw = String(row.order_id ?? "");
      const id = raw.startsWith("gid://") ? raw : `gid://shopify/Order/${raw}`;
      if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id) || ids.has(id)) throw new Error("Invalid or repeated warehouse report page; retry loading");
      ids.add(id);
    }
    if (result.results.warehouses.length < 1000) break;
  }
  if (!ids.size) return [];
  const { shop, token } = await credentials(store);
  const allIds = [...ids];
  const rows = new Map<string, WarehouseActivity>();
  for (let start = 0; start < allIds.length; start += 50) {
    const batch = allIds.slice(start, start + 50);
    const result = await shopifyGraph<{ nodes: Array<Order | null> }>(shop, token, warehouseOrdersQuery, { ids: batch });
    if (result.nodes.length !== batch.length || result.nodes.some((order) => !order?.id)) throw new Error("Some historical fulfilments are inaccessible. Check Shopify read_all_orders access before reporting warehouse costs.");
    for (const order of result.nodes) {
      if (!order || order.test) continue;
      const charged = new Set<string>();
      const fulfillments = [...order.fulfillments].filter((f) => f.status === "SUCCESS").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      for (const fulfillment of fulfillments) {
        const locationId = fulfillment.location?.id ?? "unassigned";
        const firstAtWarehouse = !charged.has(locationId);
        charged.add(locationId);
        const date = reportingDateKey(fulfillment.createdAt, store.timezone || "UTC");
        if (date < from || date > to) continue;
        if (!Number.isSafeInteger(fulfillment.totalQuantity) || fulfillment.totalQuantity < 0) throw new Error("Invalid fulfilled quantity from Shopify");
        const key = `${date}:${locationId}`;
        const row = rows.get(key) ?? { date, locationId, name: fulfillment.location?.name ?? "Unassigned warehouse", orders: 0, units: 0 };
        row.orders += firstAtWarehouse ? 1 : 0;
        row.units += fulfillment.totalQuantity;
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()];
}

// Share concurrent summary/chart loads without retaining stale fulfilment results.
const activeLoads = new Map<string, Promise<WarehouseActivity[]>>();
export function loadWarehouseActivity(store: Store, from: string, to: string) {
  const key = [store.id, store.shopify_domain, store.timezone, from, to].join(":");
  const existing = activeLoads.get(key);
  if (existing) return existing;
  const promise = fetchWarehouseActivity(store, from, to).finally(() => activeLoads.delete(key));
  activeLoads.set(key, promise);
  return promise;
}
