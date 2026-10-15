import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { loadBillingEstimates } from "@/lib/shopify/billing-estimates";
import { syncBillingFx } from "@/lib/shopify/billing-fx";
import { selectAllPages } from "@/lib/supabase/select-all";
import type { DatedExchangeRate } from "@/lib/analytics/exchange-rate";

export const maxDuration = 120;

export async function POST(request: Request) {
  const w = await requireWorkspace();
  if (!w.ok) return w.response;
  if (!w.store) return NextResponse.json({ error: "Select a store first" }, { status: 404 });
  if (!["owner", "admin"].includes(w.membership.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (input?.storeId !== w.store.id) return NextResponse.json({ error: "The selected store changed. Reload Expenses." }, { status: 409 });
  const [billing, rates] = await Promise.all([
    loadBillingEstimates(w.supabase, w.store.id),
    selectAllPages<DatedExchangeRate>(p => w.supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", w.store!.id).eq("quote_currency", w.store!.currency).order("id").range(p.from, p.to)),
  ]);
  if (billing.error || rates.error) return NextResponse.json({ error: billing.error || rates.error }, { status: 500 });
  return NextResponse.json(await syncBillingFx(w.supabase, billing.charges, w.store.currency, rates.rows, { storeId: w.store.id, organizationId: w.membership.organization_id, userId: w.userId }));
}
