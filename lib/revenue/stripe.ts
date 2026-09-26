import type { RevenueEntry } from "./schema";

export type StripeRecord = { id: string; created: number; currency: string; amount: number; amount_captured?: number; paid?: boolean; captured?: boolean; status: string; livemode?: boolean; metadata?: Record<string,string> };
export function stripeEntries(records: StripeRecord[], account: string, kind: "sale" | "refund", timezone: string): RevenueEntry[] {
  return records.filter(r => r.status === "succeeded" && r.livemode !== false && (kind === "refund" || (r.paid && r.captured))).map(r => {
    const currency = r.currency.toUpperCase();
    let amount = kind === "sale" ? r.amount_captured ?? r.amount : r.amount;
    // Stripe represents ISK and UGX with two decimals despite their zero-decimal display.
    if (currency === "ISK" || currency === "UGX") amount /= 100;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 9_000_000_000_000) throw new Error("Unsupported Stripe amount");
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(r.created * 1000));
    const get = (type: string) => parts.find(p => p.type === type)!.value;
    return { entry_key: `stripe:${account}:${r.id}`, external_id: r.id, entry_date: `${get("year")}-${get("month")}-${get("day")}`, kind, label: kind === "sale" ? "Stripe payment" : "Stripe refund", amount_minor: amount, currency, opportunity_id: r.metadata?.ghl_opportunity_id?.slice(0,120) || null };
  });
}
