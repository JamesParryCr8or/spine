/**
 * Pure helpers for ShopifyQL's campaign_sales dataset: the query text and the
 * row parsing. No I/O, so it is unit tested; relative imports only.
 */

export type ShopifyQlRow = Record<string, string | number | null>;

export type CampaignDailyRow = {
  organization_id: string;
  store_id: string;
  sales_date: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  customer_type: "new" | "returning" | "unknown";
  last_click_orders: number;
  last_click_sales: number;
  last_non_direct_orders: number;
  last_non_direct_sales: number;
  first_click_orders: number;
  first_click_sales: number;
  currency: string;
  synced_at: string;
};

export const campaignMeasures = [
  "campaign_last_click_order_count", "campaign_last_click_total_sales",
  "campaign_last_non_direct_click_order_count", "campaign_last_non_direct_click_total_sales",
  "campaign_first_click_order_count", "campaign_first_click_total_sales",
] as const;

export function campaignQuery(from: string, to: string) {
  return `FROM campaign_sales
SHOW ${campaignMeasures.join(", ")}
GROUP BY utm_source, utm_medium, utm_campaign, new_or_returning_customer
TIMESERIES day
SINCE ${from} UNTIL ${to}
ORDER BY day ASC`;
}

/** Money and counts arrive as strings that may carry a currency symbol or thousands separators. */
export function parseNumber(value: unknown) {
  const number = Number(typeof value === "string" ? value.replace(/[^0-9.\-]/g, "") : value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

const clean = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "");

function customerType(value: unknown): CampaignDailyRow["customer_type"] {
  const text = clean(value);
  return text === "new" ? "new" : text === "returning" ? "returning" : "unknown";
}

/**
 * Turns query rows into table rows. Rows with no attributed orders or sales
 * are dropped (the dataset emits zero rows for empty days), and rows that
 * normalise to the same key are summed so an upsert never sees a duplicate.
 */
export function parseCampaignRows(rows: ShopifyQlRow[], context: { organizationId: string; storeId: string; currency: string; now: string }): CampaignDailyRow[] {
  const merged = new Map<string, CampaignDailyRow>();
  for (const row of rows) {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const next = {
      last_click_orders: Math.max(0, Math.trunc(parseNumber(row.campaign_last_click_order_count))),
      last_click_sales: parseNumber(row.campaign_last_click_total_sales),
      last_non_direct_orders: Math.max(0, Math.trunc(parseNumber(row.campaign_last_non_direct_click_order_count))),
      last_non_direct_sales: parseNumber(row.campaign_last_non_direct_click_total_sales),
      first_click_orders: Math.max(0, Math.trunc(parseNumber(row.campaign_first_click_order_count))),
      first_click_sales: parseNumber(row.campaign_first_click_total_sales),
    };
    if (Object.values(next).every((value) => value === 0)) continue;
    const source = clean(row.utm_source), medium = clean(row.utm_medium), campaign = clean(row.utm_campaign), type = customerType(row.new_or_returning_customer);
    const key = [day, source, medium, campaign, type].join("\u0000");
    const existing = merged.get(key);
    if (existing) {
      for (const field of Object.keys(next) as Array<keyof typeof next>) existing[field] += next[field];
    } else {
      merged.set(key, {
        organization_id: context.organizationId, store_id: context.storeId, sales_date: day,
        utm_source: source, utm_medium: medium, utm_campaign: campaign, customer_type: type,
        ...next, currency: context.currency, synced_at: context.now,
      });
    }
  }
  return [...merged.values()];
}

/** Splits [from, to] (inclusive ISO dates) into windows of at most `days` days, newest first. */
export function dateWindows(from: string, to: string, days: number) {
  const windows: Array<{ from: string; to: string }> = [];
  let end = new Date(`${to}T00:00:00Z`);
  const start = new Date(`${from}T00:00:00Z`);
  while (end >= start) {
    const windowStart = new Date(Math.max(start.getTime(), end.getTime() - (days - 1) * 86400000));
    windows.push({ from: windowStart.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
    end = new Date(windowStart.getTime() - 86400000);
  }
  return windows;
}
