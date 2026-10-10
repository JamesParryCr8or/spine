/**
 * Campaign performance: joins ShopifyQL attributed sales with ad spend.
 * Pure (no I/O) so it is unit tested; relative imports only.
 *
 * Spend is only ever shown against sales when a link exists: an automatic
 * name/ID match, a saved manual mapping, or uploaded custom spend. Anything
 * else stays "not matched" and is reported as unmatched spend, never guessed.
 */
import { normalizeUtmSource } from "./utm-attribution.ts";

export type AttributionModel = "last_non_direct" | "last_click" | "first_click";
export type Platform = "meta" | "google" | "microsoft";

export type CampaignDay = {
  sales_date: string; utm_source: string; utm_medium: string; utm_campaign: string; customer_type: "new" | "returning" | "unknown";
  last_click_orders: number; last_click_sales: number; last_non_direct_orders: number; last_non_direct_sales: number; first_click_orders: number; first_click_sales: number;
};
export type PlatformSpendDay = { platform: Platform; date: string; spend: number };
export type AdCampaignSpend = { platform: Platform; campaignId: string; campaignName: string; spend: number };
export type CampaignMapping = { campaignId: string; source: string; medium: string; campaign: string };
export type CustomSpendRow = { source: string; medium: string; campaign: string; spend: number };

export type SpendLink = "auto" | "manual" | "custom";
export type CampaignRow = {
  key: string; source: string; medium: string; campaign: string; platform: Platform | null;
  orders: number; sales: number; newOrders: number; aov: number;
  spend: number | null; spendLink: SpendLink | null; roas: number | null; cpa: number | null;
};
export type SourceRow = { source: string; medium: string; orders: number; sales: number; spend: number | null; roas: number | null };
export type PlatformRow = { platform: Platform; spend: number; taggedSales: number; taggedOrders: number; roas: number | null };
export type WeekPoint = { week: string; sales: number; orders: number; spend: number };
export type UnmatchedCampaign = { platform: Platform; campaignId: string; campaignName: string; spend: number };

export type CampaignPerformance = {
  rows: CampaignRow[];
  sources: SourceRow[];
  platforms: PlatformRow[];
  weekly: WeekPoint[];
  totals: { sales: number; orders: number; newOrders: number; untaggedSales: number; untaggedShare: number; adSpend: number; blendedRoas: number | null; taggedRoas: number | null };
  coverage: { campaignSpend: number; matchedSpend: number; customSpend: number; unmatched: UnmatchedCampaign[] };
};

const round2 = (value: number) => Math.round(value * 100) / 100;
/** Comparison form of a campaign name or UTM value: case, spacing and punctuation insensitive. */
export const normalizeName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const paidMedium = /(cpc|ppc|paid|cpm|cpv|display|retarget|sponsored)/;

/** Which ad platform a UTM source/medium points at, or null. Organic search and social are not ad spend. */
export function platformOf(source: string, medium: string): Platform | null {
  const normalized = normalizeUtmSource(source, "");
  const name = normalized.replace(/\.(com|co\.uk)$/, "");
  const paid = paidMedium.test(medium.toLowerCase());
  if (["facebook", "instagram", "meta", "fb", "ig"].includes(name)) return paid ? "meta" : null;
  if (["google", "googleads", "adwords", "google ads"].includes(name)) return paid ? "google" : null;
  if (["bing", "microsoft", "msn", "microsoft ads", "bing ads"].includes(name)) return paid ? "microsoft" : null;
  return null;
}

function platformOfSourceOnly(source: string): Platform | null {
  const name = normalizeUtmSource(source, "").replace(/\.(com|co\.uk)$/, "");
  if (["facebook", "instagram", "meta", "fb", "ig"].includes(name)) return "meta";
  if (["google", "googleads", "adwords"].includes(name)) return "google";
  if (["bing", "microsoft", "msn"].includes(name)) return "microsoft";
  return null;
}

const measures = {
  last_non_direct: ["last_non_direct_orders", "last_non_direct_sales"],
  last_click: ["last_click_orders", "last_click_sales"],
  first_click: ["first_click_orders", "first_click_sales"],
} as const;

function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function computeCampaignPerformance(input: {
  days: CampaignDay[];
  model: AttributionModel;
  platformSpend: PlatformSpendDay[];
  adCampaigns: AdCampaignSpend[];
  mappings: CampaignMapping[];
  customSpend: CustomSpendRow[];
}): CampaignPerformance {
  const [ordersKey, salesKey] = measures[input.model];
  const groups = new Map<string, CampaignRow>();
  const weekly = new Map<string, WeekPoint>();
  let sales = 0, orders = 0, newOrders = 0, untaggedSales = 0;

  for (const day of input.days) {
    const dayOrders = day[ordersKey], daySales = day[salesKey];
    if (dayOrders === 0 && daySales === 0) continue;
    // Attributed sales are used as reported by Shopify (total sales incl. shipping and tax).
    const source = normalizeUtmSource(day.utm_source, ""), medium = day.utm_medium.trim().toLowerCase(), campaign = day.utm_campaign.trim().toLowerCase();
    const key = [source, medium, campaign].join("\u0000");
    const row = groups.get(key) ?? { key, source, medium, campaign, platform: platformOf(source, medium), orders: 0, sales: 0, newOrders: 0, aov: 0, spend: null, spendLink: null, roas: null, cpa: null };
    row.orders += dayOrders; row.sales += daySales;
    if (day.customer_type === "new") row.newOrders += dayOrders;
    groups.set(key, row);
    sales += daySales; orders += dayOrders;
    if (day.customer_type === "new") newOrders += dayOrders;
    if (!source && !medium && !campaign) untaggedSales += daySales;
    const week = weekStart(day.sales_date);
    const point = weekly.get(week) ?? { week, sales: 0, orders: 0, spend: 0 };
    point.sales += daySales; point.orders += dayOrders;
    weekly.set(week, point);
  }

  // Spend -> UTM target. Manual mappings win; otherwise a campaign matches a UTM campaign with the same
  // normalised name (or ID) coming from the same platform. Unmatched campaigns are reported, not guessed.
  const rowsByCampaign = new Map<string, CampaignRow[]>();
  for (const row of groups.values()) {
    const list = rowsByCampaign.get(normalizeName(row.campaign)) ?? [];
    list.push(row);
    rowsByCampaign.set(normalizeName(row.campaign), list);
  }
  const manual = new Map(input.mappings.map((mapping) => [mapping.campaignId, mapping]));
  const spendByKey = new Map<string, { spend: number; link: SpendLink }>();
  const addSpend = (key: string, spend: number, link: SpendLink) => {
    const existing = spendByKey.get(key);
    spendByKey.set(key, { spend: (existing?.spend ?? 0) + spend, link: existing && existing.link !== link ? (existing.link === "manual" || link === "manual" ? "manual" : "auto") : link });
  };
  const keyFor = (source: string, medium: string, campaign: string) => [normalizeUtmSource(source, ""), medium.trim().toLowerCase(), campaign.trim().toLowerCase()].join("\u0000");
  const unmatched: UnmatchedCampaign[] = [];
  let campaignSpend = 0, matchedSpend = 0, customSpend = 0;

  for (const ad of input.adCampaigns) {
    campaignSpend += ad.spend;
    const mapping = manual.get(ad.campaignId);
    if (mapping) { addSpend(keyFor(mapping.source, mapping.medium, mapping.campaign), ad.spend, "manual"); matchedSpend += ad.spend; continue; }
    const candidates = [normalizeName(ad.campaignName), normalizeName(ad.campaignId)].filter(Boolean)
      .flatMap((name) => rowsByCampaign.get(name) ?? [])
      .filter((row) => platformOfSourceOnly(row.source) === ad.platform);
    if (!candidates.length) { unmatched.push({ platform: ad.platform, campaignId: ad.campaignId, campaignName: ad.campaignName, spend: round2(ad.spend) }); continue; }
    // Several UTM rows can share one campaign name (different mediums): share spend by sales.
    const totalSales = candidates.reduce((total, row) => total + row.sales, 0);
    for (const row of candidates) addSpend(row.key, totalSales > 0 ? ad.spend * row.sales / totalSales : ad.spend / candidates.length, "auto");
    matchedSpend += ad.spend;
  }
  for (const item of input.customSpend) {
    customSpend += item.spend;
    addSpend(keyFor(item.source, item.medium, item.campaign), item.spend, "custom");
  }

  const rows = [...groups.values()].map((row): CampaignRow => {
    const linked = spendByKey.get(row.key);
    const spend = linked ? round2(linked.spend) : null;
    return {
      ...row, sales: round2(row.sales), aov: row.orders ? row.sales / row.orders : 0,
      spend, spendLink: linked?.link ?? null,
      roas: spend && spend > 0 ? row.sales / spend : null,
      cpa: spend && spend > 0 && row.orders ? spend / row.orders : null,
    };
  }).sort((left, right) => right.sales - left.sales);

  const sourceMap = new Map<string, SourceRow>();
  for (const row of rows) {
    const key = `${row.source}\u0000${row.medium}`;
    const entry = sourceMap.get(key) ?? { source: row.source, medium: row.medium, orders: 0, sales: 0, spend: null, roas: null };
    entry.orders += row.orders; entry.sales += row.sales;
    if (row.spend !== null) entry.spend = (entry.spend ?? 0) + row.spend;
    sourceMap.set(key, entry);
  }
  const sources = [...sourceMap.values()].map((entry) => ({ ...entry, sales: round2(entry.sales), spend: entry.spend === null ? null : round2(entry.spend), roas: entry.spend && entry.spend > 0 ? entry.sales / entry.spend : null })).sort((left, right) => right.sales - left.sales);

  const platformTotals = new Map<Platform, { spend: number; sales: number; orders: number }>();
  for (const spendDay of input.platformSpend) {
    const total = platformTotals.get(spendDay.platform) ?? { spend: 0, sales: 0, orders: 0 };
    total.spend += spendDay.spend;
    platformTotals.set(spendDay.platform, total);
    const point = weekly.get(weekStart(spendDay.date)) ?? { week: weekStart(spendDay.date), sales: 0, orders: 0, spend: 0 };
    point.spend += spendDay.spend;
    weekly.set(weekStart(spendDay.date), point);
  }
  for (const row of rows) {
    if (!row.platform) continue;
    const total = platformTotals.get(row.platform) ?? { spend: 0, sales: 0, orders: 0 };
    total.sales += row.sales; total.orders += row.orders;
    platformTotals.set(row.platform, total);
  }
  const platforms = [...platformTotals].map(([platform, total]): PlatformRow => ({ platform, spend: round2(total.spend), taggedSales: round2(total.sales), taggedOrders: total.orders, roas: total.spend > 0 ? total.sales / total.spend : null }));
  const adSpend = platforms.reduce((total, platform) => total + platform.spend, 0);
  const taggedSales = platforms.reduce((total, platform) => total + platform.taggedSales, 0);

  return {
    rows, sources, platforms,
    weekly: [...weekly.values()].sort((left, right) => left.week.localeCompare(right.week)).map((point) => ({ ...point, sales: round2(point.sales), spend: round2(point.spend) })),
    totals: {
      sales: round2(sales), orders, newOrders, untaggedSales: round2(untaggedSales), untaggedShare: sales > 0 ? untaggedSales / sales : 0,
      adSpend: round2(adSpend), blendedRoas: adSpend > 0 ? sales / adSpend : null, taggedRoas: adSpend > 0 ? taggedSales / adSpend : null,
    },
    coverage: { campaignSpend: round2(campaignSpend), matchedSpend: round2(matchedSpend), customSpend: round2(customSpend), unmatched: unmatched.sort((left, right) => right.spend - left.spend) },
  };
}
