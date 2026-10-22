import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { loadWarehouseLocations } from "@/lib/shopify/warehouse-activity";
import type { WarehouseRate } from "@/lib/analytics/warehouse-costs";

export const maxDuration = 60;
export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store, supabase, membership } = workspace;
  if (!store) return NextResponse.json({ error: "Select a store" }, { status: 404 });
  const { data, error } = await supabase.from("store_cost_defaults").select("warehouse_costs").eq("store_id", store.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const locations = await loadWarehouseLocations(store);
    return NextResponse.json({ locations, rates: data?.warehouse_costs ?? [], currency: store.currency, canManage: ["owner", "admin"].includes(membership.role) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load warehouses" }, { status: 502 });
  }
}
export async function PUT(request: Request) {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store, supabase, membership, userId } = workspace;
  if (!store) return NextResponse.json({ error: "Select a store" }, { status: 404 });
  if (!["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rates) || body.rates.length > 500) return NextResponse.json({ error: "Provide up to 500 warehouse rates" }, { status: 400 });
  const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const rates: WarehouseRate[] = [];
  for (const input of body.rates) {
    if (!input || typeof input.locationId !== "string" || !/^gid:\/\/shopify\/Location\/\d+$/.test(input.locationId) || !date(input.from) || (input.to !== null && (!date(input.to) || input.to < input.from))) return NextResponse.json({ error: "Choose a warehouse and valid rate dates" }, { status: 400 });
    if (![input.postage, input.picking, input.storage, input.admin].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000000)) return NextResponse.json({ error: "Costs must be numbers between 0 and 1,000,000" }, { status: 400 });
    if (rates.some((rate) => rate.locationId === input.locationId)) return NextResponse.json({ error: "Use one rate row per warehouse" }, { status: 400 });
    rates.push({ locationId: input.locationId, name: "", postage: input.postage, picking: input.picking, storage: input.storage, admin: input.admin, from: input.from, to: input.to });
  }
  try {
    const locations = await loadWarehouseLocations(store);
    // Preserve rates for removed warehouses, but never accept arbitrary new location IDs.
    const previous = await supabase.from("store_cost_defaults").select("warehouse_costs").eq("store_id", store.id).maybeSingle();
    if (previous.error) throw new Error(previous.error.message);
    const known = new Map<string, string>(locations.map((location) => [location.id, location.name]));
    for (const rate of (previous.data?.warehouse_costs ?? []) as WarehouseRate[]) if (!known.has(rate.locationId)) known.set(rate.locationId, rate.name);
    for (const rate of rates) {
      if (!known.has(rate.locationId)) return NextResponse.json({ error: "Warehouse does not belong to this Shopify store" }, { status: 400 });
      rate.name = known.get(rate.locationId)!;
    }
    const { error } = await supabase.from("store_cost_defaults").upsert({ store_id: store.id, organization_id: membership.organization_id, currency: store.currency, warehouse_costs: rates, created_by: userId, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ rates });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save warehouse costs" }, { status: 502 });
  }
}
