import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

type ShippingCostInput = {
  variantId?: string;
  sku?: string;
  amount?: string | number;
  currency?: string;
  allocationBasis?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string | null;
};

const moneyPattern = /^\d{1,15}(?:\.\d{1,4})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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
  const { supabase, membership, store } = result;
  const { data, error } = await supabase.from("product_shipping_costs").select("id,variant_id,sku,allocation_basis,amount,currency,effective_from,effective_to,notes,updated_at").eq("store_id", store.id).order("effective_from", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ currency: store.currency, canEdit: ["owner", "admin"].includes(membership.role), costs: data ?? [] });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, userId, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const input = await request.json().catch(() => null) as ShippingCostInput | null;
  const variantId = input?.variantId?.trim() ?? "";
  const sku = input?.sku?.trim() || null;
  const amount = String(input?.amount ?? "").trim();
  const currency = (input?.currency || store.currency).trim().toUpperCase();
  const allocationBasis = input?.allocationBasis === "orders" ? "orders" : "units";
  const effectiveFrom = input?.effectiveFrom?.trim() ?? "";
  const effectiveTo = input?.effectiveTo?.trim() || null;
  if (!variantId && !sku) return NextResponse.json({ error: "Choose a variant or provide a SKU" }, { status: 400 });
  if (!moneyPattern.test(amount) || !/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Use a valid amount and three-letter currency code" }, { status: 400 });
  if (!datePattern.test(effectiveFrom) || (effectiveTo && !datePattern.test(effectiveTo)) || (effectiveTo && effectiveTo < effectiveFrom)) return NextResponse.json({ error: "Use valid effective dates" }, { status: 400 });

  const { data: variant, error: variantError } = variantId
    ? await supabase.from("shopify_variants").select("id,sku").eq("id", variantId).eq("store_id", store.id).maybeSingle()
    : { data: null, error: null };
  if (variantError) return NextResponse.json({ error: variantError.message }, { status: 500 });
  if (variantId && !variant) return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  const resolvedSku = variant?.sku?.trim() || sku;
  const costKey = variant ? `variant:${variant.id}` : `sku:${resolvedSku!.toLowerCase()}`;
  const { data, error } = await supabase.from("product_shipping_costs").upsert({
    organization_id: membership.organization_id,
    store_id: store.id,
    variant_id: variant?.id ?? null,
    sku: resolvedSku,
    cost_key: costKey,
    allocation_basis: allocationBasis,
    amount,
    currency,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    notes: input?.notes?.trim() || null,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id,cost_key,allocation_basis,effective_from" }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Provide a valid shipping-cost ID" }, { status: 400 });
  const { data, error } = await supabase.from("product_shipping_costs").delete().eq("id", id).eq("store_id", store.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Shipping cost not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
