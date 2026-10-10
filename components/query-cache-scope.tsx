"use client";

import { initQueryCache } from "@/lib/queries/client";

/**
 * Scopes the persisted response cache to the signed-in user and active store.
 * Rendered by the protected layout before the screens, so it runs before any
 * of their fetch effects. Renders nothing.
 */
export function QueryCacheScope({ userId, storeId }: { userId: string; storeId: string | null }) {
  initQueryCache(userId, storeId);
  return null;
}
