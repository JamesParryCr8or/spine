import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type CostInput = {
  name?: string;
  category?: string;
  amount?: string | number;
  currency?: string;
  cadence?: string;
  allocationBasis?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  taxInclusive?: boolean;
  notes?: string | null;
};

const moneyPattern = /^\d{1,15}(?:\.\d{1,4})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const categories = new Set(["software", "agency", "payroll", "warehouse", "rent", "creative", "fulfilment", "handling", "pick_pack", "duties", "other"]);
const cadences = new Set(["one_off", "daily", "weekly", "monthly", "annual"]);
const bases = new Set(["fixed", "orders", "units", "revenue"]);

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
  const { data, error } = await supabase.from("custom_costs").select("id,name,category,amount,currency,cadence,allocation_basis,effective_from,effective_to,tax_inclusive,notes,updated_at").eq("store_id", store.id).order("effective_from", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ currency: store.currency, canEdit: ["owner", "admin"].includes(membership.role), costs: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, userId, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const input = await request.json().catch(() => null) as CostInput | null;
  const name = input?.name?.trim() ?? "";
  const category = input?.category?.trim() ?? "";
  const amount = String(input?.amount ?? "").trim();
  const currency = (input?.currency || store.currency).trim().toUpperCase();
  const cadence = input?.cadence?.trim() ?? "";
  const allocationBasis = input?.allocationBasis?.trim() ?? "fixed";
  const effectiveFrom = input?.effectiveFrom?.trim() ?? "";
  const effectiveTo = input?.effectiveTo?.trim() || null;
  if (!name || name.length > 160) return NextResponse.json({ error: "Provide a cost name of up to 160 characters" }, { status: 400 });
  if (!categories.has(category) || !cadences.has(cadence) || !bases.has(allocationBasis)) return NextResponse.json({ error: "Choose a valid category, cadence and allocation basis" }, { status: 400 });
  if (!moneyPattern.test(amount) || !/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Use a valid amount and three-letter currency code" }, { status: 400 });
  if (!datePattern.test(effectiveFrom) || (effectiveTo && !datePattern.test(effectiveTo)) || (effectiveTo && effectiveTo < effectiveFrom)) return NextResponse.json({ error: "Use valid effective dates" }, { status: 400 });
  const { data, error } = await supabase.from("custom_costs").insert({ organization_id: membership.organization_id, store_id: store.id, name, category, amount, currency, cadence, allocation_basis: allocationBasis, effective_from: effectiveFrom, effective_to: effectiveTo, tax_inclusive: Boolean(input?.taxInclusive), notes: input?.notes?.trim() || null, created_by: userId, updated_at: new Date().toISOString() }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
