import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function invitationKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Supabase server key is not configured");
  return createHash("sha256").update(`spine-invitation-share-v1\0${secret}`).digest();
}

// Wrap the stored hash so existing invitations can be shared without storing
// plaintext tokens or invalidating links that have already been sent.
export function createInvitationShareToken(tokenHash: string) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error("Invalid invitation hash");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", invitationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(tokenHash, "hex")), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

export function resolveInvitationToken(token: string): string | null {
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) return createHash("sha256").update(token).digest("hex");
  if (!/^v1\.[A-Za-z0-9_-]{80}$/.test(token)) return null;
  try {
    const bytes = Buffer.from(token.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", invitationKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("hex");
  } catch {
    return null;
  }
}
