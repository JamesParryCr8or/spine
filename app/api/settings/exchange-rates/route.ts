import { NextResponse } from "next/server";

import { parseExchangeRate, parseExchangeRateId } from "@/lib/settings/exchange-rate-schema";
import { requireWorkspace } from "@/lib/workspace/server";

const fields = "id,base_currency,quote_currency,rate,effective_date,source,notes,updated_at";

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
  const { data, error } = await result.supabase.from("exchange_rates").select(fields).eq("store_id", result.store.id).order("effective_date", { ascending: false }).order("base_currency");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reportingCurrency: result.store.reporting_currency, canManage: result.membership.role === "owner" || result.membership.role === "admin", rates: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const parsed = parseExchangeRate(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.value.quoteCurrency !== result.store.reporting_currency) return NextResponse.json({ error: `Quote currency must match the store reporting currency (${result.store.reporting_currency})` }, { status: 400 });
  const { data, error } = await result.supabase.from("exchange_rates").upsert({
    organization_id: result.membership.organization_id,
    store_id: result.store.id,
    base_currency: parsed.value.baseCurrency,
    quote_currency: parsed.value.quoteCurrency,
    rate: parsed.value.rate,
    effective_date: parsed.value.effectiveDate,
    source: "manual",
    notes: parsed.value.notes,
    created_by: result.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id,base_currency,quote_currency,effective_date" }).select(fields).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rate: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const parsed = parseExchangeRateId(new URL(request.url).searchParams.get("id"));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { error } = await result.supabase.from("exchange_rates").delete().eq("id", parsed.value.id).eq("store_id", result.store.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
