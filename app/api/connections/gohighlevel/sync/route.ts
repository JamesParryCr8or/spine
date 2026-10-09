import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createReportingClient } from "@/lib/analytics/reporting-refresh";
import { syncGoHighLevelOpportunities } from "@/lib/analytics/gohighlevel-sync";

export const maxDuration = 60;

export async function POST() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin", "connector"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required to sync GoHighLevel" }, { status: 403 });

  let secretClient;
  try {
    secretClient = createReportingClient();
  } catch {
    return NextResponse.json({ error: "GoHighLevel sync is not configured on the server" }, { status: 500 });
  }
  const result = await syncGoHighLevelOpportunities(workspace.supabase, secretClient, workspace.store);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { ok: _ok, ...body } = result;
  return NextResponse.json(body);
}
