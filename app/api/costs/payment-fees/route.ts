import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type PaymentFeeInput = {
  gateway?: string;
  percentageRate?: string | number;
  fixedFee?: string | number;
  taxRate?: string | number;
  minimumFee?: string | number;
  currency?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

const ratePattern = /^\d{1,3}(?:\.\d{1,6})?$/;
const moneyPattern = /^\d{1,15}(?:\.\d{1,4})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

async function context() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { data: membership } = await supabase.from("organization_members").select("organization_id,role").eq("user_id", userId).limit(1).single();
  if (!membership) return { error: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }) };
  const { data: store } = await supabase.from("stores").select("id,currency").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return { error: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  return { supabase, userId, membership, store };
}

export async function GET() {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership, store } = result;
  const { data, error } = await supabase
    .from("payment_fee_rules")
    .select("id,gateway,percentage_rate,fixed_fee,tax_rate,minimum_fee,currency,effective_from,effective_to,updated_at")
    .eq("store_id", store.id)
    .order("effective_from", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ currency: store.currency, canEdit: ["owner", "admin"].includes(membership.role), rules: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, userId, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });

  const input = await request.json().catch(() => null) as PaymentFeeInput | null;
  const gateway = input?.gateway?.trim() ?? "";
  const percentageRate = String(input?.percentageRate ?? "0").trim();
  const fixedFee = String(input?.fixedFee ?? "0").trim();
  const taxRate = String(input?.taxRate ?? "0").trim();
  const minimumFee = String(input?.minimumFee ?? "0").trim();
  const currency = (input?.currency || store.currency).trim().toUpperCase();
  const effectiveFrom = input?.effectiveFrom?.trim() ?? "";
  const effectiveTo = input?.effectiveTo?.trim() || null;

  if (!gateway || gateway.length > 160) return NextResponse.json({ error: "Provide a gateway name of up to 160 characters" }, { status: 400 });
  if (![percentageRate, taxRate].every((value) => ratePattern.test(value)) || ![fixedFee, minimumFee].every((value) => moneyPattern.test(value))) return NextResponse.json({ error: "Use valid non-negative rates and monetary amounts" }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Use a valid three-letter currency code" }, { status: 400 });
  if (!datePattern.test(effectiveFrom) || (effectiveTo && !datePattern.test(effectiveTo)) || (effectiveTo && effectiveTo < effectiveFrom)) return NextResponse.json({ error: "Use valid effective dates" }, { status: 400 });

  const { data, error } = await supabase.from("payment_fee_rules").insert({
    organization_id: membership.organization_id,
    store_id: store.id,
    gateway,
    percentage_rate: percentageRate,
    fixed_fee: fixedFee,
    tax_rate: taxRate,
    minimum_fee: minimumFee,
    currency,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ error: "A rule already starts on that date for this gateway and currency" }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Provide a valid rule ID" }, { status: 400 });
  const { data, error } = await supabase.from("payment_fee_rules").delete().eq("id", id).eq("store_id", store.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Payment fee rule not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
