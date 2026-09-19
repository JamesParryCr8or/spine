import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { parseCustomSpendImport } from "@/lib/settings/custom-spend-schema";
import { requireWorkspace } from "@/lib/workspace/server";

const normalize = (value: string) => value.trim().toLowerCase();
const keyFor = (row: { date: string; source: string; medium: string; campaign: string; currency: string; account: string | null; adGroup: string | null; externalId: string | null }) => {
  const identity = row.externalId
    ? ["external", normalize(row.source), normalize(row.externalId)]
    : ["dimensions", row.date, normalize(row.source), normalize(row.medium), normalize(row.campaign), normalize(row.account ?? ""), normalize(row.adGroup ?? ""), row.currency];
  return createHash("sha256").update(identity.join("\u0000")).digest("hex");
};

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { error: workspace.response };
  if (!workspace.store) {
    return { error: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  }
  const { supabase, userId, membership, store } = workspace;
  return { supabase, userId, membership, store };
}

export async function GET() {
  const result = await context();
  if (result.error) return result.error;
  const [spendResult, batchResult] = await Promise.all([
    result.supabase.from("custom_spend_daily").select("id,spend_date,source,medium,campaign,account,ad_group,currency,spend,external_id,updated_at").eq("store_id", result.store.id).order("spend_date", { ascending: false }).limit(100),
    result.supabase.from("custom_spend_import_batches").select("id,original_filename,row_count,inserted_count,updated_count,rolled_back_at,created_at").eq("store_id", result.store.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const error = spendResult.error ?? batchResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ canManage: result.membership.role === "owner" || result.membership.role === "admin", spend: spendResult.data ?? [], batches: batchResult.data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const parsed = parseCustomSpendImport(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const keyedRows = parsed.value.rows.map((row) => ({ row, key: keyFor(row) }));
  const keys = keyedRows.map((item) => item.key);
  const { data: existing, error: existingError } = await result.supabase.from("custom_spend_daily").select("id,organization_id,store_id,import_batch_id,spend_date,source,medium,campaign,account,ad_group,currency,spend,external_id,deterministic_key,created_by,created_at,updated_at").eq("store_id", result.store.id).in("deterministic_key", keys);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  const existingKeys = new Set((existing ?? []).map((item) => item.deterministic_key));
  const insertedCount = keys.filter((key) => !existingKeys.has(key)).length;
  const updatedCount = keys.length - insertedCount;
  const { data: batch, error: batchError } = await result.supabase.from("custom_spend_import_batches").insert({
    organization_id: result.membership.organization_id, store_id: result.store.id, original_filename: parsed.value.filename,
    row_count: keyedRows.length, inserted_count: insertedCount, updated_count: updatedCount, previous_rows: existing ?? [], created_by: result.userId,
  }).select("id,original_filename,row_count,inserted_count,updated_count,rolled_back_at,created_at").single();
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });
  const rows = keyedRows.map(({ row, key }) => ({
    organization_id: result.membership.organization_id, store_id: result.store.id, import_batch_id: batch.id,
    spend_date: row.date, source: normalize(row.source), medium: normalize(row.medium), campaign: normalize(row.campaign),
    account: row.account, ad_group: row.adGroup, currency: row.currency, spend: row.spend, external_id: row.externalId,
    deterministic_key: key, created_by: result.userId, updated_at: new Date().toISOString(),
  }));
  const { error } = await result.supabase.from("custom_spend_daily").upsert(rows, { onConflict: "store_id,deterministic_key" });
  if (error) {
    await result.supabase.from("custom_spend_import_batches").delete().eq("id", batch.id);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ batch }, { status: 201 });
}


const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
  if (!uuidPattern.test(batchId)) return NextResponse.json({ error: "A valid import batch is required" }, { status: 400 });
  const { data: batch, error: batchError } = await result.supabase.from("custom_spend_import_batches")
    .select("id,previous_rows,rolled_back_at").eq("id", batchId).eq("store_id", result.store.id).maybeSingle();
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  if (batch.rolled_back_at) return NextResponse.json({ error: "This import was already rolled back" }, { status: 409 });
  const { data: latestBatch, error: latestBatchError } = await result.supabase.from("custom_spend_import_batches")
    .select("id").eq("store_id", result.store.id).is("rolled_back_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latestBatchError) return NextResponse.json({ error: latestBatchError.message }, { status: 500 });
  if (latestBatch?.id !== batch.id) return NextResponse.json({ error: "Roll back newer imports first" }, { status: 409 });
  const previousRows = Array.isArray(batch.previous_rows) ? batch.previous_rows : [];
  if (previousRows.length) {
    const { error } = await result.supabase.from("custom_spend_daily").upsert(previousRows, { onConflict: "store_id,deterministic_key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { error: deleteError } = await result.supabase.from("custom_spend_daily").delete().eq("store_id", result.store.id).eq("import_batch_id", batch.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  const { error: updateError } = await result.supabase.from("custom_spend_import_batches").update({ rolled_back_at: new Date().toISOString(), rolled_back_by: result.userId }).eq("id", batch.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ success: true, restoredRows: previousRows.length });
}
