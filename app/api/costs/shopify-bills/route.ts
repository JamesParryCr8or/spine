import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { selectAllPages } from "@/lib/supabase/select-all";
import { parseBillingCsv, defaultBillingInclusion } from "@/lib/shopify/billing-csv";
import { billingReportingAmount, estimateBillingCosts, type BillingCost } from "@/lib/analytics/billing-costs";
import { loadBillingEstimates } from "@/lib/shopify/billing-estimates";
import { validDate } from "@/lib/revenue/schema";
import { reportingDateKey } from "@/lib/analytics/reporting-range";
import type { DatedExchangeRate } from "@/lib/analytics/exchange-rate";

async function context() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return { error: workspace.response };
  if (!workspace.store) return { error: NextResponse.json({ error: "Select a store first" }, { status: 404 }) };
  return { workspace, store: workspace.store };
}
export async function GET(request: Request) {
  const ctx = await context(); if (ctx.error) return ctx.error;
  const { workspace: w, store } = ctx;
  const page = Math.max(0, Math.min(100000, Number(new URL(request.url).searchParams.get("page")) || 0));
  const [result, fx, estimates] = await Promise.all([
    w.supabase.from("shopify_billing_charges").select("*", { count: "exact" })
      .eq("store_id", store.id).order("charge_date", { ascending: false }).order("id").range(Math.floor(page) * 50, Math.floor(page) * 50 + 49),
    selectAllPages<DatedExchangeRate>(page => w.supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date").order("id").range(page.from, page.to)),
    loadBillingEstimates(w.supabase, store.id),
  ]);
  if (result.error || fx.error || estimates.error) return NextResponse.json({ error: result.error?.message || fx.error || estimates.error }, { status: 500 });
  return NextResponse.json({ storeId: store.id, storeName: store.name, currency: store.currency, totalCount: result.count,
    estimateSettings: estimates.settings,
    estimates: estimateBillingCosts(estimates.charges, store.currency, fx.rows, estimates.coverage, estimates.settings, reportingDateKey(new Date(), store.timezone || "Europe/London"), null, null),
    charges: (result.data ?? []).map(c => ({ ...c, reporting_amount: billingReportingAmount(c as BillingCost, store.currency, fx.rows) })) });
}

export async function POST(request: Request) {
  const ctx = await context(); if (ctx.error) return ctx.error;
  const { workspace: w, store } = ctx;
  if (!["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input.csv !== "string" || input.csv.length > 2_000_000 || !["preview", "import"].includes(input.action)) return NextResponse.json({ error: "Choose a CSV up to 2 MB" }, { status: 400 });
  if (input.action === "import" && input.storeId !== store.id) return NextResponse.json({ error: "The selected store changed. Preview the file again." }, { status: 409 });
  let charges;
  try { charges = parseBillingCsv(input.csv); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid CSV" }, { status: 400 }); }
  const { data: connection, error: connectionError } = await w.supabase.from("data_connections").select("external_account_id").eq("store_id", store.id).eq("provider", "shopify").maybeSingle();
  if (connectionError) return NextResponse.json({ error: connectionError.message }, { status: 500 });
  const shopId = connection?.external_account_id?.split("/").pop();
  if (!shopId || charges.some(c => c.shop_id !== shopId)) return NextResponse.json({ error: `This CSV must contain only charges for the Shopify account connected to ${store.name}. Select the matching store and try again.` }, { status: 400 });
  if (input.action === "import") {
    if (typeof input.exportFrom !== "string" || typeof input.exportTo !== "string" || !validDate(input.exportFrom) || !validDate(input.exportTo) || input.exportFrom > input.exportTo || charges.some(c => c.charge_date < input.exportFrom || c.charge_date > input.exportTo)) return NextResponse.json({ error: "Confirm the export date range, covering every charge in the file." }, { status: 400 });
    if (!Array.isArray(input.includeCategories) || input.includeCategories.some((v: unknown) => typeof v !== "string")) return NextResponse.json({ error: "Review the categories before importing" }, { status: 400 });
    const included = new Set(input.includeCategories);
    const { data, error } = await w.supabase.rpc("import_shopify_billing", {
      requested_store_id: store.id, filename: String(input.filename || "charges_export.csv").slice(0, 240),
      export_from: input.exportFrom, export_to: input.exportTo,
      charges: charges.map(c => ({ ...c, include_in_pnl: included.has(c.category) })),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  const [existing, fx] = await Promise.all([
    selectAllPages<{ charge_key: string; bill_number: string | null; include_in_pnl: boolean }>(page => w.supabase.from("shopify_billing_charges").select("charge_key,bill_number,include_in_pnl").eq("store_id", store.id).order("id").range(page.from, page.to)),
    selectAllPages<DatedExchangeRate>(page => w.supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date").order("id").range(page.from, page.to)),
  ]);
  if (existing.error || fx.error) return NextResponse.json({ error: existing.error || fx.error }, { status: 500 });
  const prior = new Map(existing.rows.map(c => [c.charge_key, c]));
  const preview = charges.map(c => {
    const old = prior.get(c.charge_key);
    return { ...c, include_in_pnl: old?.include_in_pnl ?? defaultBillingInclusion(c.category),
      status: !old ? "new" : !old.bill_number && c.bill_number ? "updated" : "duplicate",
      reporting_amount: billingReportingAmount({ ...c, include_in_pnl: false }, store.currency, fx.rows) };
  });
  const categories = [...new Set(charges.map(c => c.category))].map(category => {
    const rows = preview.filter(c => c.category === category);
    const totals = Object.fromEntries([...new Set(rows.map(c => c.currency))].map(currency => [currency, rows.filter(c => c.currency === currency).reduce((sum, c) => sum + Number(c.amount), 0)]));
    return { category, count: rows.length, totals };
  });
  return NextResponse.json({ storeId: store.id, storeName: store.name, currency: store.currency, charges: preview.slice(0, 100),
    exportFrom: charges.reduce((min, c) => c.charge_date < min ? c.charge_date : min, charges[0].charge_date),
    exportTo: charges.reduce((max, c) => c.charge_date > max ? c.charge_date : max, charges[0].charge_date),
    totalCount: preview.length, unbilledCount: preview.filter(c => !c.bill_number).length,
    missingRates: preview.filter(c => c.bill_number && c.reporting_amount === null).length,
    counts: { new: preview.filter(c => c.status === "new").length, updated: preview.filter(c => c.status === "updated").length, duplicate: preview.filter(c => c.status === "duplicate").length }, categories,
    includeCategories: [...new Set(charges.map(c => c.category))].filter(defaultBillingInclusion) });
}

export async function PUT(request: Request) {
  const ctx = await context(); if (ctx.error) return ctx.error;
  const { workspace: w, store } = ctx;
  if (!["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (!input || input.storeId !== store.id || typeof input.enabled !== "boolean" || !input.overrides || Array.isArray(input.overrides) || typeof input.overrides !== "object" || Object.keys(input.overrides).length > 1000 || Object.entries(input.overrides).some(([key, value]) => key.length > 2500 || typeof value !== "boolean")) return NextResponse.json({ error: "Invalid estimate settings" }, { status: 400 });
  const { error } = await w.supabase.from("shopify_billing_estimate_settings").upsert({ store_id: store.id, enabled: input.enabled, overrides: input.overrides }, { onConflict: "store_id" });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const ctx = await context(); if (ctx.error) return ctx.error;
  const { workspace: w, store } = ctx;
  if (!["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input.id !== "string" || typeof input.include !== "boolean" || input.storeId !== store.id) return NextResponse.json({ error: "Invalid charge or store changed" }, { status: 400 });
  const { data, error } = await w.supabase.from("shopify_billing_charges").update({ include_in_pnl: input.include, updated_at: new Date().toISOString() }).eq("store_id", store.id).eq("id", input.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
