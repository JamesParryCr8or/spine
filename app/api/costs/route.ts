import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

type CostInput = {
  variantId?: string;
  sku?: string;
  amount?: string | number;
  currency?: string;
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

export async function GET(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership, store } = result;
  const historyFor = new URL(request.url).searchParams.get("historyFor")?.trim();

  if (historyFor) {
    const { data: events, error } = await supabase
      .from("product_cost_audit_events")
      .select("id,action,previous_value,next_value,created_at")
      .eq("store_id", store.id)
      .eq("product_cost_id", historyFor)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: events ?? [] });
  }

  const [{ data: variants, error: variantError }, { data: costs, error: costError }] = await Promise.all([
    supabase
      .from("shopify_variants")
      .select("id,product_id,shopify_gid,title,sku,price,shopify_unit_cost,currency")
      .eq("store_id", store.id)
      .order("sku"),
    supabase
      .from("product_costs")
      .select("id,variant_id,sku,source,amount,currency,effective_from,effective_to,notes,updated_at")
      .eq("store_id", store.id)
      .order("effective_from", { ascending: false }),
  ]);
  if (variantError || costError) return NextResponse.json({ error: variantError?.message ?? costError?.message }, { status: 500 });

  const productIds = [...new Set((variants ?? []).map((variant) => variant.product_id))];
  const { data: products, error: productError } = productIds.length
    ? await supabase.from("shopify_products").select("id,title").in("id", productIds)
    : { data: [], error: null };
  if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
  const productNames = new Map((products ?? []).map((product) => [product.id, product.title]));
  const orderRows: Array<{ id: string; processed_at_shopify: string | null }> = [];
  const lineRows: Array<{ order_id: string; variant_gid: string | null; sku: string | null; current_quantity: number; net_sales: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("shopify_orders").select("id,processed_at_shopify").eq("store_id", store.id).neq("test", true).is("cancelled_at", null).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    orderRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("shopify_order_lines").select("order_id,variant_gid,sku,current_quantity,net_sales").eq("store_id", store.id).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    lineRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const orderDates = new Map(orderRows.filter((order) => order.processed_at_shopify).map((order) => [order.id, order.processed_at_shopify!.slice(0, 10)]));
  const variantsByGid = new Map((variants ?? []).map((variant) => [variant.shopify_gid, variant]));
  const costsByKey = new Map<string, Array<{ effective_from: string; effective_to: string | null }>>();
  for (const cost of costs ?? []) {
    const key = cost.variant_id ? `variant:${cost.variant_id}` : cost.sku ? `sku:${cost.sku.trim().toLowerCase()}` : null;
    if (key) costsByKey.set(key, [...(costsByKey.get(key) ?? []), cost]);
  }
  const missingOrders = new Set<string>();
  let missingRevenue = 0, missingUnits = 0;
  for (const line of lineRows) {
    const date = orderDates.get(line.order_id);
    if (!date) continue;
    const variant = line.variant_gid ? variantsByGid.get(line.variant_gid) : undefined;
    const key = variant ? `variant:${variant.id}` : line.sku ? `sku:${line.sku.trim().toLowerCase()}` : null;
    const hasManualCost = key ? (costsByKey.get(key) ?? []).some((cost) => cost.effective_from <= date && (!cost.effective_to || cost.effective_to >= date)) : false;
    if (hasManualCost || variant?.shopify_unit_cost !== null && variant?.shopify_unit_cost !== undefined) continue;
    missingOrders.add(line.order_id); missingUnits += Math.max(line.current_quantity, 0); missingRevenue += Number(line.net_sales) || 0;
  }

  return NextResponse.json({
    currency: store.currency,
    missingCostImpact: { orders: missingOrders.size, units: missingUnits, revenue: missingRevenue },
    canEdit: ["owner", "admin"].includes(membership.role),
    variants: (variants ?? []).map((variant) => ({ ...variant, productTitle: productNames.get(variant.product_id) ?? "Unknown product" })),
    costs: costs ?? [],
  });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, userId, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });

  const body = await request.json().catch(() => null) as { items?: CostInput[]; source?: "manual" | "csv"; filename?: string } | null;
  const items = body?.items;
  const source = body?.source === "csv" ? "csv" : "manual";
  if (!items?.length || items.length > 2000) return NextResponse.json({ error: "Provide between 1 and 2,000 cost rows" }, { status: 400 });

  const { data: variants, error: variantsError } = await supabase
    .from("shopify_variants")
    .select("id,sku")
    .eq("store_id", store.id);
  if (variantsError) return NextResponse.json({ error: variantsError.message }, { status: 500 });
  const variantsById = new Map((variants ?? []).map((variant) => [variant.id, variant]));
  const variantsBySku = new Map((variants ?? []).filter((variant) => variant.sku).map((variant) => [variant.sku!.trim().toLowerCase(), variant]));

  const errors: string[] = [];
  const rows = items.flatMap((item, index) => {
    const sku = item.sku?.trim() || null;
    const variant = (item.variantId ? variantsById.get(item.variantId) : undefined) ?? (sku ? variantsBySku.get(sku.toLowerCase()) : undefined);
    const amount = String(item.amount ?? "").trim();
    const currency = (item.currency || store.currency).trim().toUpperCase();
    const effectiveFrom = item.effectiveFrom?.trim() || new Date().toISOString().slice(0, 10);
    const effectiveTo = item.effectiveTo?.trim() || null;
    let rowError = "";
    if (!variant && !sku) rowError = "choose a variant or provide a SKU";
    else if (!moneyPattern.test(amount)) rowError = "amount must be a positive number with up to 4 decimal places";
    else if (!/^[A-Z]{3}$/.test(currency)) rowError = "currency must be a 3-letter code";
    else if (!datePattern.test(effectiveFrom) || (effectiveTo && !datePattern.test(effectiveTo))) rowError = "use YYYY-MM-DD dates";
    else if (effectiveTo && effectiveTo < effectiveFrom) rowError = "effective-to cannot precede effective-from";
    if (rowError) { errors.push(`Row ${index + 1}: ${rowError}`); return []; }
    const resolvedSku = variant?.sku?.trim() || sku;
    return [{
      organization_id: membership.organization_id,
      store_id: store.id,
      variant_id: variant?.id ?? null,
      cost_key: variant ? `variant:${variant.id}` : `sku:${resolvedSku!.toLowerCase()}`,
      sku: resolvedSku,
      source,
      amount,
      currency,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes: item.notes?.trim() || null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }];
  });

  if (errors.length) return NextResponse.json({ error: "Some rows are invalid", errors }, { status: 400 });

  let batchId: string | null = null;
  if (source === "csv") {
    const { data: batch, error } = await supabase.from("product_cost_import_batches").insert({
      organization_id: membership.organization_id,
      store_id: store.id,
      original_filename: body?.filename?.trim() || "product-costs.csv",
      total_rows: rows.length,
      imported_rows: rows.length,
      created_by: userId,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    batchId = batch.id;
  }

  const payload = rows.map((row) => ({ ...row, import_batch_id: batchId }));
  const { data, error } = await supabase
    .from("product_costs")
    .upsert(payload, { onConflict: "store_id,cost_key,effective_from,source" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: data.length, batchId });
}


export async function PATCH(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  const { supabase, membership, store } = result;
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });

  const input = await request.json().catch(() => null) as { id?: string; amount?: string | number; effectiveTo?: string | null; notes?: string | null } | null;
  const id = input?.id?.trim();
  const amount = String(input?.amount ?? "").trim();
  const effectiveTo = input?.effectiveTo?.trim() || null;
  if (!id) return NextResponse.json({ error: "Choose a cost record to edit" }, { status: 400 });
  if (!moneyPattern.test(amount)) return NextResponse.json({ error: "Amount must be a positive number with up to 4 decimal places" }, { status: 400 });
  if (effectiveTo && !datePattern.test(effectiveTo)) return NextResponse.json({ error: "Use YYYY-MM-DD for the effective-to date" }, { status: 400 });

  const { data: current, error: currentError } = await supabase.from("product_costs").select("effective_from").eq("id", id).eq("store_id", store.id).maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Cost record not found" }, { status: 404 });
  if (effectiveTo && effectiveTo < current.effective_from) return NextResponse.json({ error: "Effective-to cannot precede effective-from" }, { status: 400 });

  const { data, error } = await supabase.from("product_costs").update({
    amount, effective_to: effectiveTo, notes: input?.notes?.trim() || null, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("store_id", store.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Cost record not found" }, { status: 404 });
  return NextResponse.json({ cost: data });
}
