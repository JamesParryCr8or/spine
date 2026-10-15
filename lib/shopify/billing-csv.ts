import { createHash } from "node:crypto";
import { parseRevenueCsv, validDate, currencyDecimals } from "../revenue/schema.ts";

export const billingHeaders = ["Bill #", "Store Name", "Shop ID", ".myshopify.com URL", "Charge category", "Description", "Amount", "Currency", "Start of billing cycle", "End of billing cycle", "Date", "Order", "Rate", "App", "Original amount", "Original currency", "Exchange rate", "Usage quantity", "Charge date"];
export type BillingCharge = {
  charge_key: string; shop_id: string; bill_number: string | null; charge_date: string;
  bill_date: string | null; category: string; description: string; amount: string;
  currency: string; original_amount: string | null; original_currency: string | null;
  raw: Record<string, string>;
};
// These charges can overlap payment fees, surcharge estimates and shipping costs.
// Unknown categories also require an explicit decision in the preview.
const expenseCategories = new Set(["application_fee", "subscription_fee", "domain_fee", "theme_fee", "shopify_tax", "shopify_collabs_commission", "shopify_collabs_processing_fee"]);
export function defaultBillingInclusion(category: string) { return expenseCategories.has(category); }

function decimal(value: string, label: string, signed = true) {
  if (!(signed ? /^-?\d{1,12}(\.\d{1,8})?$/ : /^\d{1,12}(\.\d{1,12})?$/).test(value) || !Number.isFinite(Number(value))) throw new Error(`Invalid ${label}`);
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const normalized = `${whole.replace(/^0+(?=\d)/, "")}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
  return value.startsWith("-") && normalized !== "0" ? `-${normalized}` : normalized;
}

export function parseBillingCsv(csv: string): BillingCharge[] {
  const rows = parseRevenueCsv(csv);
  const headers = rows.shift()?.map(h => h.trim()) ?? [];
  if (new Set(headers).size !== headers.length || billingHeaders.some(h => !headers.includes(h))) throw new Error("Use Shopify’s detailed Statement of charges CSV export, including all charge columns.");
  if (!rows.length || rows.length > 20000) throw new Error("Import between 1 and 20,000 charges at a time.");
  const occurrences = new Map<string, number>();
  return rows.map((values, index) => {
    try {
      if (values.length !== headers.length) throw new Error("Column count does not match the header");
      const raw = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
      const v = (key: string) => raw[key].trim();
      const shop_id = v("Shop ID"), bill_number = v("Bill #") || null;
      if (!/^\d+$/.test(shop_id) || (bill_number && !/^\d+$/.test(bill_number))) throw new Error("Invalid shop or bill number");
      const charge_date = v("Charge date") || v("Date"), bill_date = v("Date") || null;
      if (!validDate(charge_date) || (bill_date && !validDate(bill_date))) throw new Error("Invalid charge or bill date");
      for (const key of ["Start of billing cycle", "End of billing cycle"]) if (v(key) && !validDate(v(key))) throw new Error(`Invalid ${key}`);
      if (v("Start of billing cycle") && v("End of billing cycle") && v("Start of billing cycle") > v("End of billing cycle")) throw new Error("Billing cycle ends before it starts");
      const currency = v("Currency").toUpperCase(); currencyDecimals(currency);
      const amount = decimal(v("Amount"), "amount");
      const original_currency = v("Original currency").toUpperCase() || null;
      const original_amount = v("Original amount") ? decimal(v("Original amount"), "original amount") : null;
      if (Boolean(original_currency) !== (original_amount !== null)) throw new Error("Original amount and currency must be supplied together");
      if (original_currency) currencyDecimals(original_currency);
      if (v("Exchange rate") && Number(decimal(v("Exchange rate"), "exchange rate", false)) <= 0) throw new Error("Exchange rate must be positive");
      const category = v("Charge category"), description = v("Description");
      if (!category || !description || description.length > 2000) throw new Error("Missing category or description, or description too long");
      // Bill date/number and converted amount can change when an unbilled charge is invoiced.
      // Preserve repeated identical charges with occurrence suffixes; row order is otherwise irrelevant.
      const identity = [shop_id, category, description, charge_date, original_amount ?? amount, original_currency ?? currency, v("Order"), v("Rate"), v("App"), v("Usage quantity"), v("Start of billing cycle"), v("End of billing cycle")];
      const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
      const occurrence = (occurrences.get(hash) ?? 0) + 1; occurrences.set(hash, occurrence);
      return { charge_key: `${hash}:${occurrence}`, shop_id, bill_number, bill_date, charge_date, category, description, amount, currency, original_amount, original_currency, raw };
    } catch (error) { throw new Error(`CSV row ${index + 2}: ${error instanceof Error ? error.message : "Invalid charge"}`); }
  });
}

