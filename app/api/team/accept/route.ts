import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { activeOrganizationCookie, activeStoreCookie } from "@/lib/workspace/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "This invitation is invalid or expired" }, { status: 404 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("organization_invitations")
    .select("email,store_id,stores(name)")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("accepted_at", null).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "This invitation is invalid or expired" }, { status: 404 });
  const store = Array.isArray(data.stores) ? data.stores[0] : data.stores;
  return NextResponse.json({ email: data.email, storeName: store?.name ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof input?.token === "string" ? input.token : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in with the invited email first" }, { status: 401 });
  const { data: storeId, error } = await supabase.rpc("accept_organization_invitation", {
    invite_token_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: store } = await supabase.from("stores").select("id,organization_id").eq("id", storeId).maybeSingle();
  if (!store) return NextResponse.json({ error: "The invited store could not be opened" }, { status: 500 });
  const response = NextResponse.json({ ok: true });
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };
  response.cookies.set(activeOrganizationCookie, store.organization_id, cookieOptions);
  response.cookies.set(activeStoreCookie, store.id, cookieOptions);
  return response;
}
