import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { sheetsRequest, templateBody } from "@/lib/revenue/sheets";
import { validateRevenueRows } from "@/lib/revenue/schema";

export async function POST(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store || !["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  try {
    const body = await request.json();
    if (body.storeId !== w.store.id) throw new Error("The active store changed. Reload this page before importing.");
    if (body.action === "template") {
      const sheet = await sheetsRequest(w, "", templateBody(w.store.reporting_currency || w.store.currency));
      const result = await w.supabase.from("revenue_connector_settings").upsert({ store_id: w.store.id, provider: "google_sheets", settings: { spreadsheetId: sheet.spreadsheetId, tab: "Entries" } });
      if (result.error) throw new Error("Template created, but could not save the connection. Find it in Google Drive.");
      return NextResponse.json({ spreadsheetId: sheet.spreadsheetId, url: sheet.spreadsheetUrl });
    }
    const id = String(body.spreadsheetId || "").match(/^[\w-]{20,150}$/)?.[0];
    const tab = String(body.tab || "Entries");
    if (!id || tab.length > 100 || !tab.trim()) throw new Error("Enter a valid spreadsheet ID and tab name");
    const range = encodeURIComponent(`'${tab.replaceAll("'", "''")}'!A1:G5002`);
    const sheet = await sheetsRequest(w, `/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
    const rows: unknown[][] = sheet.values || [];
    // Google stores typed dates as serials. Convert only the named date column.
    const dateIndex = rows[0]?.findIndex(v => String(v).trim().toLowerCase() === "date") ?? -1;
    if (dateIndex >= 0) rows.slice(1).forEach(row => { if (typeof row[dateIndex] === "number") row[dateIndex] = new Date(Date.UTC(1899,11,30) + Number(row[dateIndex]) * 86400000).toISOString().slice(0,10); });
    const entries = validateRevenueRows(rows);
    if (!entries.length) throw new Error("Add entries to the sheet before importing");
    const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    if (!body.commit) return NextResponse.json({ entries: entries.slice(0,20), count: entries.length, digest });
    if (body.digest !== digest) throw new Error("Sheet changed since preview. Preview it again.");
    const result = await w.supabase.rpc("import_revenue_entries", { requested_store_id: w.store.id, source_name: "google_sheets", batch_name: `Google Sheets · ${tab}`, entries });
    if (result.error) throw new Error("Could not save import. No rows were imported.");
    await w.supabase.from("revenue_connector_settings").upsert({ store_id: w.store.id, provider: "google_sheets", settings: { spreadsheetId: id, tab }, last_synced_at: new Date().toISOString(), last_error: null });
    return NextResponse.json({ imported: entries.length, batchId: result.data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sheets import failed" }, { status: 400 }); }
}
