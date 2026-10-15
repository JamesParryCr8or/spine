import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingCost } from "../analytics/billing-costs.ts";
import type { DatedExchangeRate } from "../analytics/exchange-rate.ts";

export const billingFxNote = "Frankfurter daily reference rate";
type Observation = { date: string; base: string; quote: string; rate: number };

/** Use the charge date, or the preceding published observation (at most 7 days old). */
export function chargeDateRates(charges: BillingCost[], currency: string, existing: DatedExchangeRate[], observations: Observation[]) {
  const dates = new Map<string, { base: string; date: string }>();
  for (const charge of charges) {
    if (!charge.bill_number || charge.currency === currency || (charge.original_currency === currency && charge.original_amount !== null)) continue;
    dates.set(`${charge.currency}:${charge.charge_date}`, { base: charge.currency, date: charge.charge_date });
  }
  return [...dates.values()].flatMap(({ base, date }) => {
    if (existing.some(r => r.base_currency === base && r.quote_currency === currency && r.effective_date === date)) return [];
    const observation = observations.filter(r => r.base === base && r.quote === currency && r.date <= date && Number.isFinite(r.rate) && r.rate > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!observation || Date.parse(date) - Date.parse(observation.date) > 7 * 86_400_000) return [];
    return [{ base_currency: base, quote_currency: currency, effective_date: date, rate: observation.rate.toFixed(10), source: "imported", notes: `${billingFxNote}; observed ${observation.date}. Mid-market estimate, excludes bank fees.` }];
  });
}

export async function syncBillingFx(db: SupabaseClient, charges: BillingCost[], currency: string, existing: DatedExchangeRate[], context: { storeId: string; organizationId: string; userId: string }, fetcher: typeof fetch = fetch) {
  const pairs = new Map<string, string[]>();
  for (const charge of charges) {
    if (!charge.bill_number || charge.currency === currency || (charge.original_currency === currency && charge.original_amount !== null)) continue;
    if (existing.some(r => r.base_currency === charge.currency && r.quote_currency === currency && r.effective_date === charge.charge_date)) continue;
    if (!/^[A-Z]{3}$/.test(charge.currency) || !/^[A-Z]{3}$/.test(currency)) continue;
    pairs.set(charge.currency, [...(pairs.get(charge.currency) ?? []), charge.charge_date]);
  }
  let added = 0;
  const warnings: string[] = [];
  // A bounded pair list and sequential requests avoid a burst against the free provider.
  if (pairs.size > 8) warnings.push("Only eight currency pairs can be refreshed at once. Reload Expenses to fetch the remaining pairs.");
  for (const [base, dates] of [...pairs].slice(0, 8)) {
    try {
      dates.sort();
      const from = new Date(Date.parse(dates[0]) - 7 * 86_400_000).toISOString().slice(0, 10);
      const query = new URLSearchParams({ base, quotes: currency, from, to: dates.at(-1)! });
      const response = await fetcher(`https://api.frankfurter.dev/v2/rates?${query}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
      if (!response.ok) throw new Error(`FX provider returned ${response.status}`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("Invalid FX response");
      const observations = body.filter((row): row is Observation => row && typeof row === "object" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.base === base && row.quote === currency && typeof row.rate === "number" && Number.isFinite(row.rate) && row.rate > 0);
      const rows = chargeDateRates(charges.filter(c => c.currency === base), currency, existing, observations);
      for (let offset = 0; offset < rows.length; offset += 500) {
        const { data, error } = await db.from("exchange_rates").upsert(rows.slice(offset, offset + 500).map(row => ({ ...row, store_id: context.storeId, organization_id: context.organizationId, created_by: context.userId })), { onConflict: "store_id,base_currency,quote_currency,effective_date", ignoreDuplicates: true }).select("id");
        if (error) throw new Error(error.message);
        added += data?.length ?? 0;
      }
      if (rows.length < new Set(dates).size) warnings.push(`Some ${base} → ${currency} charge dates have no published rate.`);
    } catch (reason) { warnings.push(`${base} → ${currency}: ${reason instanceof Error ? reason.message : "Could not fetch FX rates"}`); }
  }
  return { added, warnings };
}
