import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "./exchange-rate.ts";

export type BillingCost = {
  bill_number: string | null; charge_date: string; amount: string; currency: string;
  original_amount: string | null; original_currency: string | null; include_in_pnl: boolean;
  category?: string; raw?: Record<string, string>;
};
export function billingReportingAmount(charge: BillingCost, currency: string, rates: DatedExchangeRate[]) {
  if (charge.currency === currency) return Number(charge.amount);
  if (charge.original_currency === currency && charge.original_amount !== null) return Number(charge.original_amount);
  const rate = resolveDatedExchangeRate(rates, charge.currency, currency, charge.charge_date);
  return rate === null ? null : convertDatedAmount(Number(charge.amount), rate, currency);
}

export type BillingCoverage = { covered_from: string; covered_to: string };
export type BillingEstimateSettings = { enabled: boolean; overrides: Record<string, boolean> };
export function billingItemKey(charge: BillingCost) {
  return JSON.stringify([charge.category ?? "other", charge.raw?.App?.trim() || ""]);
}
export function fixedBillingCategory(category: string) { return category === "application_fee" || category === "subscription_fee"; }
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const shift = (day: string, count: number) => dateKey(new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000));
function days(from: string, to: string) {
  const result: string[] = [];
  for (let day = from; day <= to; day = shift(day, 1)) result.push(day);
  return result;
}

/** Estimates are calculated, never stored as actual charges. Only elapsed days in the current month qualify. */
export function estimateBillingCosts(charges: BillingCost[], currency: string, rates: DatedExchangeRate[], coverage: BillingCoverage[], settings: BillingEstimateSettings, today: string, from: string | null, to: string | null) {
  const start = `${today.slice(0, 7)}-01`;
  const [year, month] = start.split("-").map(Number);
  const monthEnd = dateKey(new Date(Date.UTC(year, month, 0)));
  const covered = (day: string) => coverage.some(c => c.covered_from <= day && c.covered_to >= day);
  const historicalMonths: string[] = [];
  for (let n = 12; n >= 1; n--) {
    const first = dateKey(new Date(Date.UTC(year, month - 1 - n, 1)));
    const last = dateKey(new Date(Date.UTC(year, month - n, 0)));
    if (days(first, last).every(covered)) historicalMonths.push(first.slice(0, 7));
  }
  const historicalSet = new Set(historicalMonths);
  const groups = new Map<string, BillingCost[]>();
  for (const charge of charges) {
    const key = billingItemKey(charge);
    const group = groups.get(key);
    if (group) group.push(charge); else groups.set(key, [charge]);
  }
  let total = 0, missingRates = 0;
  const items = [...groups.entries()].map(([key, rows]) => {
    const category = rows[0].category ?? "other";
    const label = rows[0].raw?.App?.trim() || category.replaceAll("_", " ");
    const enabled = settings.overrides[key] ?? fixedBillingCategory(category);
    const history = rows.filter(c => c.include_in_pnl && c.bill_number && historicalSet.has(c.charge_date.slice(0, 7)));
    const amounts = history.map(c => billingReportingAmount(c, currency, rates));
    const missing = amounts.some(a => a === null);
    const monthlyAverage = !historicalMonths.length || missing ? null : Math.max(0, amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0) / historicalMonths.length);
    const dailyAverage = monthlyAverage === null ? null : monthlyAverage / Number(monthEnd.slice(8));
    const cycles = rows.filter(c => c.include_in_pnl && c.bill_number && c.raw?.["Start of billing cycle"] && c.raw?.["End of billing cycle"]);
    const actualDates = new Set(rows.filter(c => c.bill_number).map(c => c.charge_date));
    const pendingDates = new Set(rows.filter(c => !c.bill_number).map(c => c.charge_date));
    const estimateDays = days(start, today).filter(day => (!from || day >= from) && (!to || day <= to)
      && (!covered(day) || pendingDates.has(day)) && !actualDates.has(day)
      && !cycles.some(c => c.raw!["Start of billing cycle"] <= day && c.raw!["End of billing cycle"] >= day)).length;
    const estimated = settings.enabled && enabled && dailyAverage !== null ? dailyAverage * estimateDays : 0;
    if (settings.enabled && enabled && estimateDays && missing) missingRates++;
    total += estimated;
    return { key, label, category, enabled, monthlyAverage, dailyAverage, estimateDays, estimated, missingRates: missing };
  });
  return { total, missingRates, monthsUsed: historicalMonths.length, items, today, monthStart: start };
}
export function billingPeriodCosts(charges: BillingCost[], currency: string, rates: DatedExchangeRate[], from: string | null, to: string | null) {
  let total = 0, missingRates = 0;
  for (const charge of charges) {
    if (!charge.include_in_pnl || !charge.bill_number || !from || !to || charge.charge_date < from || charge.charge_date > to) continue;
    const amount = billingReportingAmount(charge, currency, rates);
    if (amount === null) missingRates++; else total += amount;
  }
  return { total, missingRates };
}
