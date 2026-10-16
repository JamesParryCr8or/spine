import "server-only";

import type { ShopifyQlRow } from "@/lib/analytics/campaign-rows";
import { shopifyGraph } from "@/lib/shopify/graphql";
import { createAdminClient } from "@/lib/supabase/admin";

type ShopifyQlResult = { shopifyqlQuery: { tableData: { rows: ShopifyQlRow[] } | null; parseErrors: string[] } };
export type StoreQlOutcome<T extends string> = { ok: true; results: Record<T, ShopifyQlRow[]> } | { ok: false; status: number; error: string };

/**
 * Runs named ShopifyQL queries for a store, in parallel. The Shopify token is
 * read with the service role, so call this only after the request's workspace
 * membership has been confirmed (requireWorkspace). Nothing is stored.
 */
export async function runStoreShopifyQl<T extends string>(store: { id: string; shopify_domain: string | null }, queries: Record<T, string>): Promise<StoreQlOutcome<T>> {
  if (!store.shopify_domain) return { ok: false, status: 404, error: "Connect Shopify to see this report" };
  const { data: token, error: tokenError } = await createAdminClient().rpc("read_connection_secret_for_server", { requested_store_id: store.id, connection_provider: "shopify" });
  if (tokenError || typeof token !== "string" || !token) return { ok: false, status: 404, error: "Shopify is not connected for this store" };
  const shop = store.shopify_domain;
  try {
    const entries = await Promise.all((Object.keys(queries) as T[]).map(async (name) => {
      const result = await shopifyGraph<ShopifyQlResult>(
        shop, token,
        `query StoreQl($shopifyQl:String!){ shopifyqlQuery(query:$shopifyQl){ tableData{ rows } parseErrors } }`,
        { shopifyQl: queries[name] },
      );
      const parseError = result.shopifyqlQuery.parseErrors[0];
      if (parseError) throw new Error(`Shopify query (${name}): ${parseError}`);
      if (!result.shopifyqlQuery.tableData) throw new Error(`Shopify query (${name}) returned no report. Please retry.`);
      return [name, result.shopifyqlQuery.tableData.rows] as const;
    }));
    return { ok: true, results: Object.fromEntries(entries) as Record<T, ShopifyQlRow[]> };
  } catch (error) {
    return { ok: false, status: 502, error: error instanceof Error ? error.message : "Shopify could not run the query" };
  }
}
