import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const metaStateCookie = "spine_meta_oauth_state";
export const metaPendingCookie = "spine_meta_oauth_pending";
export const metaCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
type Context = { userId: string; storeId: string; organizationId: string };
export type MetaSession = Context & { nonce: string; expires: number; lookbackMonths: number; accessToken?: string };

// Separate authenticated encryption keys for the state and pending credential.
function key(secret: string, purpose: string) {
  return createHash("sha256").update(`spine-meta-${purpose}\0${secret}`).digest();
}
export function sealMetaSession(session: MetaSession, secret: string, purpose: "state" | "pending") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openMetaSession(value: string | undefined, secret: string, purpose: "state" | "pending", context: Context, now = Date.now()): MetaSession | null {
  try {
    if (!value || !secret) return null;
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as MetaSession;
    if (session.userId !== context.userId || session.storeId !== context.storeId || session.organizationId !== context.organizationId
      || !session.nonce || !Number.isFinite(session.expires) || session.expires <= now || session.expires > now + 600_000
      || !Number.isInteger(session.lookbackMonths) || session.lookbackMonths < 1 || session.lookbackMonths > 36
      || (purpose === "pending" && !session.accessToken)) return null;
    return session;
  } catch { return null; }
}
