import { NextResponse } from "next/server";

import { createReportingClient } from "@/lib/analytics/reporting-refresh";
import { requireWorkspace } from "@/lib/workspace/server";

type Contact = { dateAdded?: string };
type Opportunity = { createdAt?: string; dateAdded?: string; lastStageChangeAt?: string };

const dateKey = (value: string | undefined) => value && /^\\d{4}-\\d{2}-\\d{2}/.test(value) ? value.slice(0, 10) : null;
const usDate = (date: string) => { const [year, month, day] = date.split("-"); return `${month}-${day}-${year}`; };

export async function POST(request: Request) {
  const params = await request.json().catch(() => ({})) as { from?: string; to?: string };
  if (!params.from || !params.to || params.from > params.to) return NextResponse.json({ error: "Choose a valid reporting period" }, { status: 400 });
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });
  if (!["owner", "admin"].includes(workspace.membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });

  const [connectionResult, configResult] = await Promise.all([
    workspace.supabase.from("data_connections").select("external_account_id").eq("store_id", workspace.store.id).eq("provider", "gohighlevel").eq("status", "connected").maybeSingle(),
    workspace.supabase.from("gohighlevel_reporting_configs").select("source_type,selection_id,metric_label").eq("store_id", workspace.store.id).maybeSingle(),
  ]);
  if (connectionResult.error || configResult.error) return NextResponse.json({ error: connectionResult.error?.message ?? configResult.error?.message }, { status: 500 });
  const connection = connectionResult.data; const config = configResult.data;
  if (!connection?.external_account_id || !config) return NextResponse.json({ error: "Connect and configure GoHighLevel first" }, { status: 400 });

  const reporting = createReportingClient();
  const secret = await reporting.rpc("read_connection_secret_for_server", { requested_store_id: workspace.store.id, connection_provider: "gohighlevel" });
  if (secret.error || typeof secret.data !== "string" || !secret.data) return NextResponse.json({ error: secret.error?.message ?? "The GoHighLevel key is unavailable" }, { status: 500 });
  const headers = { Authorization: `Bearer ${secret.data}`, Version: "v3", Accept: "application/json" };
  let records: Array<Contact | Opportunity> = [];
  if (config.source_type === "opportunities") {
    const query = new URLSearchParams({ locationId: connection.external_account_id, limit: "100", page: "1", order: "added_desc", date: usDate(params.from), endDate: usDate(params.to), status: "all" });
    if (config.selection_id) { query.set("pipelineId", config.selection_id); query.set("pipelineStageId", config.selection_id); }
    const response = await fetch(`https://services.leadconnectorhq.com/opportunities/search?${query}`, { headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { opportunities?: Opportunity[]; message?: string; error?: string };
    if (!response.ok) return NextResponse.json({ error: payload.message ?? payload.error ?? "GoHighLevel could not import opportunities" }, { status: 400 });
    records = payload.opportunities ?? [];
  } else {
    const query = new URLSearchParams({ locationId: connection.external_account_id, limit: "100", startAfter: String(Date.parse(`${params.from}T00:00:00Z`)), query: config.selection_id ?? "" });
    const response = await fetch(`https://services.leadconnectorhq.com/contacts/?${query}`, { headers: { ...headers, Version: "2023-02-21" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { contacts?: Contact[]; message?: string; error?: string };
    if (!response.ok) return NextResponse.json({ error: payload.message ?? payload.error ?? "GoHighLevel could not import contacts" }, { status: 400 });
    records = payload.contacts ?? [];
  }

  const counts = new Map<string, number>();
  for (const record of records) {
    const date = dateKey(config.source_type === "opportunities" ? ((record as Opportunity).createdAt ?? (record as Opportunity).dateAdded ?? (record as Opportunity).lastStageChangeAt) : (record as Contact).dateAdded);
    if (date && date >= params.from && date <= params.to) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const now = new Date().toISOString();
  const rows = [...counts.entries()].map(([metric_date, lead_count]) => ({ organization_id: workspace.membership.organizationId, store_id: workspace.store.id, metric_date, source_type: config.source_type, selection_id: config.selection_id ?? null, metric_label: config.metric_label, lead_count, synced_at: now }));
  const deleted = await reporting.from("gohighlevel_leads_daily").delete().eq("store_id", workspace.store.id).eq("source_type", config.source_type).eq("metric_label", config.metric_label).gte("metric_date", params.from).lte("metric_date", params.to);
  if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 });
  if (rows.length) {
    const written = await reporting.from("gohighlevel_leads_daily").upsert(rows, { onConflict: "store_id,metric_date,source_type,metric_label" });
    if (written.error) return NextResponse.json({ error: written.error.message }, { status: 500 });
  }
  return NextResponse.json({ imported: records.length, conversions: rows.reduce((sum, row) => sum + row.lead_count, 0), days: rows.length });
}
