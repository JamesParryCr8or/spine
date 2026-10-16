import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { selectAllPages } from "@/lib/supabase/select-all";
import type { PurchaseOrder, PurchaseLine } from "@/lib/stock/planning";
export async function GET(request: Request) {
  const workspace = await requireWorkspace({ storeId: new URL(request.url).searchParams.get("storeId"), strict: true });
  if (!workspace.ok) return workspace.response;
  if (!workspace.store) return NextResponse.json({ error: "Select a store" }, { status: 400 });
  const result = await selectAllPages<PurchaseOrder>((range) => workspace.supabase.from("stock_purchase_orders").select("id,reference,supplier,warehouse,currency,expected_date,notes,lines,created_at").eq("store_id", workspace.store!.id).order("created_at", { ascending: false }).order("id").range(range.from, range.to));
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ orders: result.rows });
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.storeId !== "string") return NextResponse.json({ error: "Select a store" }, { status: 400 });
  const workspace = await requireWorkspace({ storeId: body.storeId, strict: true });
  if (!workspace.ok) return workspace.response;
  if (!workspace.store || !["owner", "admin"].includes(workspace.membership.role)) return NextResponse.json({ error: "An owner or admin can save purchase orders." }, { status: 403 });
  const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  if (!text(body.reference, 100) || !text(body.supplier, 200) || !text(body.warehouse, 200) || typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency) || typeof body.notes !== "string" || body.notes.length > 4000 || (body.expected_date && (typeof body.expected_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expected_date))) || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 1000) return NextResponse.json({ error: "Check supplier, destination, currency and order lines." }, { status: 400 });
  const valid = body.lines.every((line: PurchaseLine) => line && text(line.variantId, 200) && text(line.title, 500) && typeof line.sku === "string" && line.sku.length <= 200 && typeof line.variant === "string" && line.variant.length <= 500 && Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 10000000 && (line.unitCost === null || (typeof line.unitCost === "number" && Number.isFinite(line.unitCost) && line.unitCost >= 0 && line.unitCost <= 100000000)) && (line.image === null || (typeof line.image === "string" && line.image.length <= 2000 && line.image.startsWith("https://"))));
  if (!valid || new Set(body.lines.map((line: PurchaseLine) => line.variantId)).size !== body.lines.length) return NextResponse.json({ error: "Use unique products with valid quantities and costs." }, { status: 400 });
  const { data, error } = await workspace.supabase.from("stock_purchase_orders").insert({ store_id: workspace.store.id, created_by: workspace.userId, reference: body.reference.trim(), supplier: body.supplier.trim(), warehouse: body.warehouse.trim(), currency: body.currency, expected_date: body.expected_date || null, notes: body.notes, lines: body.lines.map((line: PurchaseLine) => ({ variantId: line.variantId, title: line.title, variant: line.variant, sku: line.sku, image: line.image, quantity: line.quantity, unitCost: line.unitCost })) }).select("id,reference,supplier,warehouse,currency,expected_date,notes,lines,created_at").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "That PO reference already exists. Choose a new reference." : error.message }, { status: 400 });
  return NextResponse.json({ order: data });
}
