import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { activeOrganizationCookie, activeStoreCookie } from "@/lib/workspace/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof input?.token === "string" ? input.token : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in with the invited email first" }, { status: 401 });
  const { data: organizationId, error } = await supabase.rpc("accept_organization_invitation", {
    invite_token_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: store } = await supabase.from("stores").select("id").eq("organization_id", organizationId).order("created_at").limit(1).maybeSingle();
  const response = NextResponse.json({ ok: true });
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };
  response.cookies.set(activeOrganizationCookie, organizationId, cookieOptions);
  if (store) response.cookies.set(activeStoreCookie, store.id, cookieOptions);
  return response;
}
