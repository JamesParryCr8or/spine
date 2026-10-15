import { createClient } from "@supabase/supabase-js";
import { selectAllPages } from "../lib/supabase/select-all.ts";
import { syncBillingFx } from "../lib/shopify/billing-fx.ts";
import { billingPeriodCosts } from "../lib/analytics/billing-costs.ts";

const storeId = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(storeId ?? "")) throw new Error("Pass the store UUID to backfill");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Server Supabase environment is required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: store, error } = await db.from("stores").select("id,name,organization_id,currency").eq("id", storeId).single();
if (error) throw error;
const charges = await selectAllPages(p => db.from("shopify_billing_charges").select("bill_number,charge_date,amount,currency,original_amount,original_currency,include_in_pnl,created_by").eq("store_id", storeId).order("id").range(p.from, p.to));
if (charges.error) throw new Error(charges.error);
const userId = charges.rows.find(c => c.created_by)?.created_by;
if (!userId) throw new Error("No importing user found");
async function rates() {
  const result = await selectAllPages(p => db.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date,notes").eq("store_id", storeId).eq("quote_currency", store.currency).order("id").range(p.from, p.to));
  if (result.error) throw new Error(result.error);
  return result.rows;
}
const existing = await rates();
const before = billingPeriodCosts(charges.rows, store.currency, existing, "2010-01-01", "2099-12-31");
const sync = await syncBillingFx(db, charges.rows, store.currency, existing, { storeId, organizationId: store.organization_id, userId });
const after = billingPeriodCosts(charges.rows, store.currency, await rates(), "2010-01-01", "2099-12-31");
console.log(JSON.stringify({ store: store.name, currency: store.currency, sync, before, after }, null, 2));
