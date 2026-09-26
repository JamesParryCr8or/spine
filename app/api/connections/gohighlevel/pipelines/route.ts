import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requireWorkspace } from "@/lib/workspace/server";

type Pipeline = { id?: string; name?: string; stages?: Array<{ id?: string; name?: string; position?: number }> };

export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) return NextResponse.json({ error: "Lead reporting is not configured on the server" }, { status: 500 });
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: token, error: tokenError } = await admin.rpc("read_connection_secret_for_server", {
    requested_store_id: workspace.store.id,
    connection_provider: "gohighlevel",
  });
  if (tokenError || !token) return NextResponse.json({ error: tokenError?.message ?? "No GoHighLevel token is available for this store" }, { status: 400 });
  const { data: connection, error: connectionError } = await workspace.supabase
    .from("data_connections").select("external_account_id").eq("store_id", workspace.store.id).eq("provider", "gohighlevel").maybeSingle();
  if (connectionError || !connection?.external_account_id) return NextResponse.json({ error: connectionError?.message ?? "No GoHighLevel location is connected" }, { status: 400 });

  const response = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(connection.external_account_id)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { pipelines?: Pipeline[]; message?: string; error?: string };
  if (!response.ok) return NextResponse.json({ error: payload.message ?? payload.error ?? "GoHighLevel could not load pipelines. Ensure the private integration includes opportunities.readonly." }, { status: 400 });
  return NextResponse.json({ pipelines: (payload.pipelines ?? []).map((pipeline) => ({ id: pipeline.id ?? "", name: pipeline.name ?? "Unnamed pipeline", stages: (pipeline.stages ?? []).map((stage) => ({ id: stage.id ?? "", name: stage.name ?? "Unnamed stage", position: stage.position ?? 0 })) })) });
}
