import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";

/** Data is fresh for 5 minutes: revisiting a screen in that window makes no request. */
export const staleTimeMs = 5 * 60_000;
/** Cached responses survive reloads for a day, so a returning visit paints the last real numbers immediately. */
export const gcTimeMs = 24 * 60 * 60_000;
/** Bump to discard every persisted cache after a response-shape change. */
const schemaVersion = "1";
const storageKey = "spine-query-cache";

let queryClient: QueryClient | null = null;
let persister: ReturnType<typeof createAsyncStoragePersister> | null = null;
let initialised = false;
let scope = "anon";
let restored: Promise<unknown> = Promise.resolve();

export function getQueryClient() {
  queryClient ??= new QueryClient({
    defaultOptions: { queries: { staleTime: staleTimeMs, gcTime: gcTimeMs, refetchOnWindowFocus: false, retry: 1 } },
  });
  return queryClient;
}

// IndexedDB can be unavailable (private windows, blocked storage): treat that as an empty cache.
const storage = {
  getItem: async (key: string) => { try { return (await get<string>(key)) ?? null; } catch { return null; } },
  setItem: async (key: string, value: string) => { try { await set(key, value); } catch { /* cache stays in memory */ } },
  removeItem: async (key: string) => { try { await del(key); } catch { /* nothing to remove */ } },
};

/**
 * Scopes the cache to one user and store and starts restoring the persisted
 * copy. Call before any screen fetches (the provider does it during render, on
 * the client only). Entries are keyed by user:store, and the persisted copy is
 * discarded outright when a different user signs in, so one person's numbers
 * can never paint for another.
 */
export function initQueryCache(userId: string, storeId: string | null) {
  scope = `${userId}:${storeId ?? "none"}`;
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  persister = createAsyncStoragePersister({ storage, key: storageKey, throttleTime: 1_000 });
  const [, restore] = persistQueryClient({
    queryClient: getQueryClient(),
    persister,
    maxAge: gcTimeMs,
    buster: `${schemaVersion}:${userId}`,
    dehydrateOptions: { shouldDehydrateQuery: (query) => query.state.status === "success" && query.queryKey[0] === "api" },
  });
  restored = restore.catch(() => undefined);
  clearCacheAfterMutations();
}

// APIs whose successful writes change what the cached reports show. The login
// refresh (/api/sync/login) is deliberately absent: it starts background work
// and must not wipe the cache it exists to keep warm.
const mutationPrefixes = ["/api/costs", "/api/settings", "/api/connections", "/api/revenue", "/api/sync"];
const keepsCache = (pathname: string) => pathname === "/api/sync/login";

/**
 * Any successful write to the APIs above empties the response cache, so a
 * report never shows numbers from before a cost, setting or connection change
 * (or after "Sync now"). The clear is awaited before the caller sees the
 * response, so a reload straight afterwards can't restore the old copy.
 */
function clearCacheAfterMutations() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD" && response.ok) {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const { pathname } = new URL(href, window.location.origin);
        if (mutationPrefixes.some((prefix) => pathname.startsWith(prefix)) && !keepsCache(pathname)) await clearQueryCache();
      }
    } catch { /* never let cache housekeeping break a request */ }
    return response;
  };
}

/** Resolves once the persisted cache has been read back (or after a short wait, so a slow disk never blocks a screen). */
const whenRestored = async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([restored, new Promise((resolve) => { timer = setTimeout(resolve, 1_200); })]);
  } finally {
    clearTimeout(timer);
  }
};

const keyFor = (url: string) => ["api", scope, url] as const;

async function requestJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error ?? "") : "";
    throw new Error(message || "The report could not be loaded");
  }
  return payload;
}

export type CachedJson<T> = { data: T; fresh: boolean };

/** The cached response for a URL (even if stale), or null. Waits for the persisted cache to load first. */
export async function peekJson<T>(url: string): Promise<CachedJson<T> | null> {
  await whenRestored();
  const state = getQueryClient().getQueryState<T>(keyFor(url));
  if (!state || state.data === undefined) return null;
  return { data: state.data, fresh: Date.now() - state.dataUpdatedAt < staleTimeMs };
}

/**
 * Fetches a URL through the cache. Fresh cached data is returned without a
 * request; otherwise it is fetched (concurrent callers share one request) and
 * cached. `force` always requests.
 */
export async function fetchJson<T>(url: string, options: { force?: boolean; signal?: AbortSignal; staleTime?: number } = {}): Promise<T> {
  await whenRestored();
  return getQueryClient().fetchQuery({
    queryKey: keyFor(url),
    queryFn: ({ signal }) => requestJson(url, options.signal ?? signal) as Promise<T>,
    staleTime: options.force ? 0 : options.staleTime ?? staleTimeMs,
  });
}

/** Drops cached responses whose URL starts with `prefix` (call after a mutation that changes them). */
export function invalidateJson(prefix: string) {
  getQueryClient().removeQueries({ predicate: (query) => query.queryKey[0] === "api" && typeof query.queryKey[2] === "string" && query.queryKey[2].startsWith(prefix) });
}

/** Empties the memory and persisted caches: on sign-out and store switch. */
export async function clearQueryCache() {
  getQueryClient().clear();
  await persister?.removeClient();
  await storage.removeItem(storageKey);
}
