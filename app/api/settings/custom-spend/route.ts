import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { parseCustomSpendImport } from "@/lib/settings/custom-spend-schema";
import { createClient } from "@/lib/supabase/server";

const normalize = (value: string) => value.trim().toLowerCase();
const keyFor = (row: { date: string; source: string; medium: string; campaign: string; currency: string; account: string | null; adGroup: string | null; externalId: string | null }) => {
  const identity = row.externalId
    ? ["external", normalize(row.source), normalize(row.externalId)]
    : ["dimensions", row.date, normalize(row.source), normalize(row.medium), normalize(row.campaign), normalize(row.account ?? ""), normalize(row.adGroup ?? ""), row.currency];
  return createHash("sha256").update(identity.join("\u0000")).digest("hex");
};

async function context() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { data: membership } = await supabase.from("organization_members").select("organization_id,role").eq("user_id", userId).limit(1).single();
  if (!membership) return { error: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }) };
  const { data: store } = await supabase.from("stores").select("id").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return { error: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  return { supabase, userId, membership, store };
}

export async function GET() {
  const result = await context();
  if (result.error) return result.error;
  const [spendResult, batchResult] = await Promise.all([
    result.supabase.from("custom_spend_daily").select("id,spend_date,source,medium,campaign,account,ad_group,currency,spend,external_id,updated_at").eq("store_id", result.store.id).order("spend_date", { ascending: false }).limit(100),
    result.supabase.from("custom_spend_import_batches").select("id,original_filename,row_count,inserted_count,updated_count,created_at").eq("store_id", result.store.id).order("created_at", { ascending: false }).limit(20),
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
  const { data: existing, error: existingError } = await result.supabase.from("custom_spend_daily").select("deterministic_key").eq("store_id", result.store.id).in("deterministic_key", keys);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  const existingKeys = new Set((existing ?? []).map((item) => item.deterministic_key));
  const insertedCount = keys.filter((key) => !existingKeys.has(key)).length;
  const updatedCount = keys.length - insertedCount;
  const { data: batch, error: batchError } = await result.supabase.from("custom_spend_import_batches").insert({
    organization_id: result.membership.organization_id, store_id: result.store.id, original_filename: parsed.value.filename,
    row_count: keyedRows.length, inserted_count: insertedCount, updated_count: updatedCount, created_by: result.userId,
  }).select("id,original_filename,row_count,inserted_count,updated_count,created_at").single();
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
