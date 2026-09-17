import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).single();
  if (!membership) return NextResponse.json({ error: "No workspace is configured" }, { status: 403 });
  const { data: store } = await supabase.from("stores").select("id").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return NextResponse.json({ connected: false, lastSuccessfulSync: null, latestStatus: null, recordsProcessed: 0, warnings: 0 });
  const [connectionResult, successfulResult, latestResult] = await Promise.all([
    supabase.from("data_connections").select("status").eq("store_id", store.id).eq("provider", "shopify").maybeSingle(),
    supabase.from("sync_runs").select("completed_at,records_processed,warnings").eq("store_id", store.id).eq("source", "shopify").eq("status", "completed").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sync_runs").select("status,updated_at,error_message").eq("store_id", store.id).eq("source", "shopify").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = connectionResult.error ?? successfulResult.error ?? latestResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const completed = successfulResult.data;
  return NextResponse.json({
    connected: connectionResult.data?.status === "connected",
    lastSuccessfulSync: completed?.completed_at ?? null,
    recordsProcessed: completed?.records_processed ?? 0,
    warnings: Array.isArray(completed?.warnings) ? completed.warnings.length : 0,
    latestStatus: latestResult.data?.status ?? null,
    latestError: latestResult.data?.error_message ?? null,
  });
}
