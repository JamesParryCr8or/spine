import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

type Basis = "orders" | "units";

function parseAmount(value: unknown, label: string): { value?: number; error?: string } {
  const amount = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return { error: `${label} must be between 0 and 1,000,000` };
  return { value: amount };
}

function parseBasis(value: unknown, label: string): { value?: Basis; error?: string } {
  if (value !== "orders" && value !== "units") return { error: `${label} must be orders or units` };
  return { value: value as Basis };
}

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { error: workspace.response };
  if (!workspace.store) return { error: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  const { supabase, userId, membership, store } = workspace;
  return { supabase, userId, membership, store };
}

function responseDefaults(row: { fulfilment_amount: string; fulfilment_basis: Basis; postage_amount: string; postage_basis: Basis; default_cogs_percent: string; currency: string } | null, currency: string) {
  return {
    fulfilmentAmount: row?.fulfilment_amount ?? "0",
    fulfilmentBasis: row?.fulfilment_basis ?? "orders",
    postageAmount: row?.postage_amount ?? "0",
    postageBasis: row?.postage_basis ?? "orders",
    defaultCogsPercent: row?.default_cogs_percent ?? "0",
    currency: row?.currency ?? currency,
  };
}

export async function GET() {
  const result = await context();
  if ("error" in result) return result.error;
  const { data, error } = await result.supabase.from("store_cost_defaults").select("fulfilment_amount,fulfilment_basis,postage_amount,postage_basis,default_cogs_percent,currency").eq("store_id", result.store.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    defaults: responseDefaults(data, result.store.currency),
    canManage: result.membership.role === "owner" || result.membership.role === "admin",
  });
}

export async function PUT(request: Request) {
  const result = await context();
  if ("error" in result) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Use a valid JSON body" }, { status: 400 });
  const fulfilmentAmount = parseAmount(body.fulfilmentAmount, "Fulfilment cost");
  const postageAmount = parseAmount(body.postageAmount, "Postage cost");
  const defaultCogsPercent = parseAmount(body.defaultCogsPercent, "Default product COGS rate");
  const fulfilmentBasis = parseBasis(body.fulfilmentBasis, "Fulfilment basis");
  const postageBasis = parseBasis(body.postageBasis, "Postage basis");
  const validationError = fulfilmentAmount.error || postageAmount.error || defaultCogsPercent.error || fulfilmentBasis.error || postageBasis.error;
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const { data, error } = await result.supabase.from("store_cost_defaults").upsert({
    organization_id: result.membership.organization_id,
    store_id: result.store.id,
    currency: result.store.currency,
    fulfilment_amount: fulfilmentAmount.value!,
    fulfilment_basis: fulfilmentBasis.value!,
    postage_amount: postageAmount.value!,
    postage_basis: postageBasis.value!,
    default_cogs_percent: defaultCogsPercent.value!,
    created_by: result.userId,
    updated_by: result.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id" }).select("fulfilment_amount,fulfilment_basis,postage_amount,postage_basis,default_cogs_percent,currency").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ defaults: responseDefaults(data, result.store.currency), canManage: true });
}
