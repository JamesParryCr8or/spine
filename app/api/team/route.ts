import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageTeam } from "@/lib/workspace/permissions";
import { requireWorkspace } from "@/lib/workspace/server";

const allowedInviteRoles = new Set(["admin", "analyst", "connector", "viewer"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const organizationId = workspace.membership.organizationId;
  const [rolesResult, membersResult] = await Promise.all([
    workspace.supabase.from("organization_roles").select("key,label,description,can_view_reports,can_view_customer_details,can_manage_data,can_manage_connections,can_manage_team"),
    workspace.supabase.from("organization_members").select("user_id,email,role,created_at").eq("organization_id", organizationId).order("created_at"),
  ]);
  if (rolesResult.error || membersResult.error) return NextResponse.json({ error: rolesResult.error?.message || membersResult.error?.message }, { status: 500 });
  let invitations: Array<{ id: string; email: string; role: string; created_at: string; expires_at: string }> = [];
  if (canManageTeam(workspace.membership.role)) {
    const result = await workspace.supabase.from("organization_invitations")
      .select("id,email,role,created_at,expires_at")
      .eq("organization_id", organizationId)
      .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    invitations = result.data ?? [];
  }
  return NextResponse.json({
    role: workspace.membership.role,
    userId: workspace.userId,
    canManageTeam: canManageTeam(workspace.membership.role),
    roles: rolesResult.data ?? [],
    members: membersResult.data ?? [],
    invitations,
  });
}

export async function POST(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!canManageTeam(workspace.membership.role)) return NextResponse.json({ error: "Team management access is required" }, { status: 403 });
  const input = await request.json().catch(() => null) as { email?: unknown; role?: unknown } | null;
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const role = typeof input?.role === "string" ? input.role : "";
  if (!emailPattern.test(email) || email.length > 254 || !allowedInviteRoles.has(role)) {
    return NextResponse.json({ error: "Choose a valid email and invitation role" }, { status: 400 });
  }
  const admin = createAdminClient();
  const organizationId = workspace.membership.organizationId;
  const { data: existing } = await admin.from("organization_members")
    .select("user_id").eq("organization_id", organizationId).eq("email", email).maybeSingle();
  if (existing) return NextResponse.json({ error: "This person already belongs to the workspace" }, { status: 409 });
  await admin.from("organization_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", organizationId).eq("email", email)
    .is("accepted_at", null).is("revoked_at", null).lte("expires_at", new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await admin.from("organization_invitations").insert({
    organization_id: organizationId, email, role, token_hash: tokenHash, invited_by: workspace.userId,
  }).select("id,email,role,expires_at").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A pending invitation already exists for this email" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin;
  const inviteUrl = new URL(`/invite/${token}`, siteUrl).toString();
  return NextResponse.json({ invitation: data, inviteUrl }, { status: 201 });
}

export async function PATCH(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!canManageTeam(workspace.membership.role)) return NextResponse.json({ error: "Team management access is required" }, { status: 403 });
  const input = await request.json().catch(() => null) as { userId?: unknown; role?: unknown } | null;
  const userId = typeof input?.userId === "string" ? input.userId : "";
  const role = typeof input?.role === "string" ? input.role : "";
  if (!allowedInviteRoles.has(role) || !/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Invalid member or role" }, { status: 400 });
  if (userId === workspace.userId) return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  const admin = createAdminClient();
  const { data: member } = await admin.from("organization_members").select("role")
    .eq("organization_id", workspace.membership.organizationId).eq("user_id", userId).maybeSingle();
  if (!member || member.role === "owner") return NextResponse.json({ error: "This member cannot be changed" }, { status: 403 });
  const { error } = await admin.from("organization_members").update({ role })
    .eq("organization_id", workspace.membership.organizationId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!canManageTeam(workspace.membership.role)) return NextResponse.json({ error: "Team management access is required" }, { status: 403 });
  const input = await request.json().catch(() => null) as { invitationId?: unknown; userId?: unknown } | null;
  const admin = createAdminClient();
  const organizationId = workspace.membership.organizationId;
  if (typeof input?.invitationId === "string") {
    const { error } = await admin.from("organization_invitations").update({ revoked_at: new Date().toISOString() })
      .eq("id", input.invitationId).eq("organization_id", organizationId).is("accepted_at", null).is("revoked_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof input?.userId !== "string" || input.userId === workspace.userId) return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  const { data: member } = await admin.from("organization_members").select("role")
    .eq("organization_id", organizationId).eq("user_id", input.userId).maybeSingle();
  if (!member || member.role === "owner") return NextResponse.json({ error: "This member cannot be removed" }, { status: 403 });
  const { error } = await admin.from("organization_members").delete()
    .eq("organization_id", organizationId).eq("user_id", input.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
