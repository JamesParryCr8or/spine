import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, userId, membership } = workspace;
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("connection_secret_audit_events")
    .select("id,provider,action,actor_user_id,metadata,created_at")
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [], currentUserId: userId });
}
