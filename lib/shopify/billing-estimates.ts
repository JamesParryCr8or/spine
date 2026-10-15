import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/select-all.ts";
import type { BillingCost, BillingCoverage, BillingEstimateSettings } from "../analytics/billing-costs.ts";

export async function loadBillingEstimates(db: SupabaseClient, storeId: string) {
  const [charges, coverage, settings] = await Promise.all([
    selectAllPages<BillingCost>(page => db.from("shopify_billing_charges").select("bill_number,charge_date,amount,currency,original_amount,original_currency,include_in_pnl,category,raw").eq("store_id", storeId).order("id").range(page.from, page.to)),
    selectAllPages<BillingCoverage>(page => db.from("shopify_billing_coverage").select("covered_from,covered_to").eq("store_id", storeId).order("id").range(page.from, page.to)),
    db.from("shopify_billing_estimate_settings").select("enabled,overrides").eq("store_id", storeId).maybeSingle(),
  ]);
  return { charges: charges.rows, coverage: coverage.rows, settings: (settings.data ?? { enabled: true, overrides: {} }) as BillingEstimateSettings, error: charges.error ?? coverage.error ?? settings.error?.message ?? null };
}
