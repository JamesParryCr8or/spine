import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { parseRevenueCsv, validateRevenueRows } from "@/lib/revenue/schema";

export async function POST(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store || !["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  try {
    const body = await request.json();
    if (body.storeId !== w.store.id) throw new Error("The active store changed. Reload this page before importing.");
    if (typeof body.csv !== "string") throw new Error("Choose a CSV file");
    const entries = validateRevenueRows(parseRevenueCsv(body.csv));
    if (!entries.length) throw new Error("Add at least one entry before importing");
    const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    if (!body.commit) return NextResponse.json({ entries: entries.slice(0,20), count: entries.length, digest });
    if (body.digest !== digest) throw new Error("File changed since preview. Preview it again.");
    const { data, error } = await w.supabase.rpc("import_revenue_entries", { requested_store_id: w.store.id, source_name: "csv", batch_name: String(body.name || "CSV import").slice(0,200), entries });
    if (error) throw new Error("Import could not be saved. No rows were imported.");
    return NextResponse.json({ batchId: data, imported: entries.length });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid import" }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store || !["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("batch");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
  const { error } = await w.supabase.from("revenue_import_batches").update({ rolled_back_at: new Date().toISOString() }).eq("id", id).eq("store_id", w.store.id).neq("source", "stripe");
  return error ? NextResponse.json({ error: "Could not roll back import" }, { status: 500 }) : NextResponse.json({ rolledBack: true });
}
