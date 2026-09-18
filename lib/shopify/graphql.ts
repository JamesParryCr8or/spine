const API_VERSION = "2026-07";
const MAX_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 15_000;

type GraphPayload<T> = {
  data?: T;
  errors?: Array<{ extensions?: { code?: string } }>;
  extensions?: { cost?: {
    requestedQueryCost?: number;
    throttleStatus?: { currentlyAvailable?: number; restoreRate?: number };
  } };
};

type Dependencies = {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

// Only used for read-only import queries: retrying mutations needs separate safeguards.
export async function shopifyGraph<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  dependencies: Dependencies = {},
): Promise<T> {
  const fetchRequest = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response | undefined;
    let payload: GraphPayload<T> = {};
    try {
      response = await fetchRequest(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      payload = await response.json().catch(() => ({})) as GraphPayload<T> ?? {};
    } catch {
      // Do not persist raw network errors or upstream messages: they may include credentials.
    }

    const errors = payload.errors ?? [];
    const throttled = response?.status === 429 || errors.some((error) => error.extensions?.code === "THROTTLED");
    const transientGraphError = errors.length > 0 && errors.every((error) =>
      error.extensions?.code === "THROTTLED" || error.extensions?.code === "INTERNAL_SERVER_ERROR");
    const retryable = !response || response.status === 429 ||
      [500, 502, 503, 504].includes(response.status) || (response.ok && transientGraphError);

    if (response?.ok && !errors.length && payload.data != null) return payload.data;

    if (!retryable) {
      if (response?.status === 401 || response?.status === 403) {
        throw new Error("Shopify denied access. Check the saved token and required app scopes, then reconnect.");
      }
      throw new Error("Shopify could not complete the import query. Check the app scopes and API configuration.");
    }

    const failure = throttled
      ? "Shopify is limiting import requests. Please try the import again shortly."
      : "Shopify is temporarily unavailable. Please try the import again shortly.";
    if (attempt === MAX_ATTEMPTS - 1) throw new Error(failure);

    let delay = 1000 * 2 ** attempt + Math.floor(random() * 250);
    const retryAfter = response?.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const requestedDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now();
      if (Number.isFinite(requestedDelay)) delay = Math.max(delay, requestedDelay);
    }
    if (throttled) {
      const cost = payload.extensions?.cost;
      const available = cost?.throttleStatus?.currentlyAvailable;
      const rate = cost?.throttleStatus?.restoreRate;
      if (typeof cost?.requestedQueryCost === "number" && typeof available === "number" && typeof rate === "number" && rate > 0) {
        delay = Math.max(delay, Math.ceil((cost.requestedQueryCost - available) / rate * 1000));
      }
    }
    // Fail instead of retrying earlier than Shopify permits or occupying the route indefinitely.
    if (delay > MAX_RETRY_DELAY_MS) throw new Error(failure);
    await sleep(delay);
  }
  throw new Error("Shopify import could not complete.");
}
