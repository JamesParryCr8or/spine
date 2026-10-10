import { fetchJson, invalidateJson } from "@/lib/queries/client";

/**
 * Compatibility wrappers over the persisted query cache (lib/queries/client.ts).
 * New code should use fetchJson / peekJson there directly.
 */
export function invalidateCachedJson(prefix: string) {
  invalidateJson(prefix);
}

export function fetchCachedJson<T>(
  key: string,
  options: { force?: boolean; ttlMs?: number } = {},
): Promise<T> {
  return fetchJson<T>(key, { force: options.force, staleTime: options.ttlMs });
}
