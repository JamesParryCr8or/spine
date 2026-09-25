const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

export function peekCachedJson<T>(key: string): T | null {
  const cached = responseCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) responseCache.delete(key);
    return null;
  }
  return cached.value as T;
}

export async function fetchCachedJson<T>(
  key: string,
  options: { force?: boolean; ttlMs?: number; init?: RequestInit } = {},
): Promise<T> {
  const { force = false, ttlMs = 120_000, init } = options;
  if (!force) {
    const cached = peekCachedJson<T>(key);
    if (cached !== null) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  } else {
    responseCache.delete(key);
  }

  const request = fetch(key, { cache: "no-store", ...init })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "")
          : "";
        throw new Error(error || "The report could not be loaded");
      }
      responseCache.set(key, { expiresAt: Date.now() + ttlMs, value: payload });
      return payload as T;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request as Promise<T>;
}
