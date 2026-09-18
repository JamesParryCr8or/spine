import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", userId)
    .limit(1)
    .single();
  if (membershipError || !membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
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
