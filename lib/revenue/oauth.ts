import { createHmac, timingSafeEqual } from "node:crypto";

export type RevenueProvider = "stripe" | "google_sheets";
export function isRevenueProvider(value: string): value is RevenueProvider {
  return value === "stripe" || value === "google_sheets";
}
export type OAuthState = { nonce: string; userId: string; storeId: string; organizationId: string; expires: number };
export function signState(state: OAuthState, key: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}
export function verifyState(value: string, key: string, nonce: string, now = Date.now()): OAuthState | null {
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) return null;
    const expected = createHmac("sha256", key).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString()) as OAuthState;
    return state.nonce === nonce && state.expires > now && state.expires <= now + 600_000 && state.userId && state.storeId && state.organizationId ? state : null;
  } catch { return null; }
}
