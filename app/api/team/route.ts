import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageTeam } from "@/lib/workspace/permissions";
import { requireWorkspace } from "@/lib/workspace/server";

const allowedInviteRoles = new Set(["admin", "analyst", "connector", "viewer"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function selectedWorkspace(request: Request) {
  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId");
  return requireWorkspace(storeId ? { storeId, strict: true } : {});
}

export async function GET(request: Request) {
  const workspace = await selectedWorkspace(request);
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "Choose a store to manage its team" }, { status: 404 });

  const organizationId = workspace.membership.organizationId;
  const storeId = workspace.store.id;
  const [rolesResult, storeMembersResult, organizationAdminsResult] = await Promise.all([
    workspace.supabase.from("organization_roles").select("key,label,description,can_view_reports,can_view_customer_details,can_manage_data,can_manage_connections,can_manage_team"),
    workspace.supabase.from("store_memberships").select("user_id,email,role,created_at").eq("store_id", storeId).order("created_at"),
    workspace.membership.storeId
      ? canManageTeam(workspace.membership.role)
        ? createAdminClient().from("organization_members").select("user_id,email,role,created_at")
          .eq("organization_id", organizationId).in("role", ["owner", "admin"]).order("created_at")
        : Promise.resolve({ data: [], error: null })
      : workspace.supabase.from("organization_members").select("user_id,email,role,created_at")
        .eq("organization_id", organizationId).order("created_at"),
  ]);
  if (rolesResult.error || storeMembersResult.error || organizationAdminsResult.error) {
    return NextResponse.json({ error: rolesResult.error?.message || storeMembersResult.error?.message || organizationAdminsResult.error?.message }, { status: 500 });
  }

  const members = [
    ...(organizationAdminsResult.data ?? []).map((member) => ({ ...member, scope: "workspace" as const })),
    ...(storeMembersResult.data ?? []).map((member) => ({ ...member, scope: "store" as const })),
  ];
  let invitations: Array<{ id: string; email: string; role: string; created_at: string; expires_at: string }> = [];
  if (canManageTeam(workspace.membership.role)) {
    const result = await workspace.supabase.from("organization_invitations")
      .select("id,email,role,created_at,expires_at")
      .eq("organization_id", organizationId).eq("store_id", storeId)
      .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    invitations = result.data ?? [];
  }
  return NextResponse.json({
    role: workspace.membership.role,
    userId: workspace.userId,
    canManageTeam: canManageTeam(workspace.membership.role),
    activeStoreId: storeId,
    activeStoreName: workspace.store.name,
    stores: workspace.stores.map((store) => ({ id: store.id, name: store.name, organizationId: store.organization_id })),
    roles: rolesResult.data ?? [],
    members,
    invitations,
  });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { email?: unknown; role?: unknown; storeId?: unknown } | null;
  const storeId = typeof input?.storeId === "string" ? input.storeId : "";
  const workspace = await requireWorkspace(storeId ? { storeId, strict: true } : {});
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "Choose a store for this invitation" }, { status: 400 });
  if (!canManageTeam(workspace.membership.role)) return NextResponse.json({ error: "Team management access is required for this store" }, { status: 403 });

  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const role = typeof input?.role === "string" ? input.role : "";
  if (!emailPattern.test(email) || email.length > 254 || !allowedInviteRoles.has(role)) {
    return NextResponse.json({ error: "Choose a valid email and invitation role" }, { status: 400 });
  }
  const admin = createAdminClient();
  const organizationId = workspace.membership.organizationId;
  const { data: existingMember } = await admin.from("organization_members")
    .select("user_id").eq("organization_id", organizationId).eq("email", email).maybeSingle();
  const { data: existingStoreMember } = await admin.from("store_memberships")
    .select("user_id").eq("store_id", workspace.store.id).eq("email", email).maybeSingle();
  if (existingMember || existingStoreMember) return NextResponse.json({ error: "This person already has access to this store" }, { status: 409 });

  await admin.from("organization_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("store_id", workspace.store.id).eq("email", email)
    .is("accepted_at", null).is("revoked_at", null).lte("expires_at", new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await admin.from("organization_invitations").insert({
    organization_id: organizationId,
    store_id: workspace.store.id,
    email,
    role,
    token_hash: tokenHash,
    invited_by: workspace.userId,
  }).select("id,email,role,store_id,expires_at").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A pending invitation already exists for this store and email" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin;
  const inviteUrl = new URL(`/invite/${token}`, siteUrl).toString();
  return NextResponse.json({ invitation: data, inviteUrl }, { status: 201 });
}

export async function PATCH(request: Request) {
  const input = await request.json().catch(() => null) as { userId?: unknown; role?: unknown; storeId?: unknown } | null;
  const storeId = typeof input?.storeId === "string" ? input.storeId : "";
  const userId = typeof input?.userId === "string" ? input.userId : "";
  const role = typeof input?.role === "string" ? input.role : "";
  const workspace = await requireWorkspace(storeId ? { storeId, strict: true } : {});
  if (!workspace.ok) return workspace.response;
  if (!workspace.store || !canManageTeam(workspace.membership.role)) return NextResponse.json({ error: "Team management access is required for this store" }, { status: 403 });
  if (!allowedInviteRoles.has(role) || !/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Invalid member or role" }, { status: 400 });
  if (userId === workspace.userId) return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  const admin = createAdminClient();
  const { data: member } = await admin.from("store_memberships").select("role")
    .eq("store_id", workspace.store.id).eq("user_id", userId).maybeSingle();
  if (!member) return NextResponse.json({ error: "This person is not a member of this store" }, { status: 404 });
  const { error } = await admin.from("store_memberships").update({ role })
    .eq("store_id", workspace.store.id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const input = await request.json().catch(() => null) as { invitationId?: unknown; userId?: unknown; storeId?: unknown } | null;
  const storeId = typeof input?.storeId === "string" ? input.storeId : "";
  const workspace = await requireWorkspace(storeId ? { storeId, strict: true } : {});
  if (!workspace.ok) return workspace.response;
  if (!workspace.store || !canManageTeam(workspace.membership.role)) return NextResponse.json({ error: "Team management access is required for this store" }, { status: 403 });
  const admin = createAdminClient();
  if (typeof input?.invitationId === "string") {
    const { error } = await admin.from("organization_invitations").update({ revoked_at: new Date().toISOString() })
      .eq("id", input.invitationId).eq("store_id", workspace.store.id).is("accepted_at", null).is("revoked_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof input?.userId !== "string" || input.userId === workspace.userId) return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  const { data: member } = await admin.from("store_memberships").select("role")
    .eq("store_id", workspace.store.id).eq("user_id", input.userId).maybeSingle();
  if (!member) return NextResponse.json({ error: "This person is not a member of this store" }, { status: 404 });
  const { error } = await admin.from("store_memberships").delete()
    .eq("store_id", workspace.store.id).eq("user_id", input.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
