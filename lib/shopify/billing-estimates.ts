import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/select-all.ts";
import { affiliateBillingCategories, billingPeriodCosts, estimateBillingCosts, type BillingCost, type BillingCoverage, type BillingEstimateSettings } from "../analytics/billing-costs.ts";
import type { DatedExchangeRate } from "../analytics/exchange-rate.ts";
import { reportingDateKey } from "../analytics/reporting-range.ts";

export async function loadBillingEstimates(db: SupabaseClient, storeId: string, categories?: string[]) {
  const [charges, coverage, settings] = await Promise.all([
    selectAllPages<BillingCost>(page => {
      let query = db.from("shopify_billing_charges").select("bill_number,charge_date,amount,currency,original_amount,original_currency,include_in_pnl,category,raw").eq("store_id", storeId);
      if (categories) query = query.in("category", categories);
      return query.order("id").range(page.from, page.to);
    }),
    selectAllPages<BillingCoverage>(page => db.from("shopify_billing_coverage").select("covered_from,covered_to").eq("store_id", storeId).order("id").range(page.from, page.to)),
    db.from("shopify_billing_estimate_settings").select("enabled,overrides").eq("store_id", storeId).maybeSingle(),
  ]);
  return { charges: charges.rows, coverage: coverage.rows, settings: (settings.data ?? { enabled: true, overrides: {} }) as BillingEstimateSettings, error: charges.error ?? coverage.error ?? settings.error?.message ?? null };
}

/** Same affiliate costs used by P&L, for Overview's blended acquisition metrics. */
export async function loadBillingMarketingCosts(db: SupabaseClient, store: { id: string; currency: string; timezone?: string | null }, from: string | null, to: string | null) {
  const [billing, rates] = await Promise.all([
    loadBillingEstimates(db, store.id, affiliateBillingCategories),
    selectAllPages<DatedExchangeRate>(p => db.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date,notes").eq("store_id", store.id).eq("quote_currency", store.currency).order("id").range(p.from, p.to)),
  ]);
  if (billing.error || rates.error) return { total: 0, error: billing.error || rates.error };
  const actuals = billingPeriodCosts(billing.charges, store.currency, rates.rows, from, to);
  const estimates = estimateBillingCosts(billing.charges, store.currency, rates.rows, billing.coverage, billing.settings, reportingDateKey(new Date(), store.timezone || "Europe/London"), from, to);
  return { total: actuals.marketing + estimates.marketing, error: null };
}
