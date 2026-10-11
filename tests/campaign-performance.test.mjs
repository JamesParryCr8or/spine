import assert from "node:assert/strict";
import test from "node:test";

import { computeCampaignPerformance, normalizeName, platformOf } from "../lib/analytics/campaign-performance.ts";
import { campaignQuery, dateWindows, parseCampaignRows } from "../lib/analytics/campaign-rows.ts";

const day = (extra = {}) => ({ sales_date: "2026-07-06", utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "summer_sale", customer_type: "new", orders: 2, net_sales: 200, ...extra });
const base = { platformSpend: [], adCampaigns: [], mappings: [], customSpend: [] };

test("platformOf only counts paid mediums as ad platforms", () => {
  assert.equal(platformOf("fb", "paid_social"), "meta");
  assert.equal(platformOf("instagram.com", "cpc"), "meta");
  assert.equal(platformOf("facebook", "social"), null);
  assert.equal(platformOf("google", "cpc"), "google");
  assert.equal(platformOf("google", "organic"), null);
  assert.equal(platformOf("bing", "cpc"), "microsoft");
});

test("meta campaign matches the same-named UTM campaign automatically", () => {
  const result = computeCampaignPerformance({ ...base, days: [day()], adCampaigns: [{ platform: "meta", campaignId: "1", campaignName: "Summer Sale", spend: 50 }] });
  assert.equal(result.rows[0].spend, 50);
  assert.equal(result.rows[0].spendLink, "auto");
  assert.equal(result.rows[0].roas, 4);
  assert.equal(result.rows[0].cpa, 25);
  assert.equal(result.coverage.matchedSpend, 50);
  assert.equal(result.coverage.unmatched.length, 0);
});

test("a Google campaign matches a numeric-ID UTM campaign and keeps its name", () => {
  const result = computeCampaignPerformance({ ...base, days: [day({ utm_source: "google", utm_medium: "cpc", utm_campaign: "21612094953" })], adCampaigns: [{ platform: "google", campaignId: "21612094953", campaignName: "Brand - UK", spend: 40 }] });
  assert.equal(result.rows[0].spend, 40);
  assert.equal(result.rows[0].spendLink, "auto");
  assert.equal(result.rows[0].roas, 5);
  assert.equal(result.rows[0].adCampaignName, "Brand - UK");
  assert.equal(result.coverage.unmatched.length, 0);
});

test("a campaign from another platform never auto-matches", () => {
  const result = computeCampaignPerformance({ ...base, days: [day({ utm_source: "google", utm_medium: "cpc" })], adCampaigns: [{ platform: "meta", campaignId: "1", campaignName: "summer_sale", spend: 50 }] });
  assert.equal(result.rows[0].spend, null);
  assert.equal(result.rows[0].roas, null);
  assert.deepEqual(result.coverage.unmatched.map((item) => item.campaignId), ["1"]);
});

test("manual mapping wins and unmatched spend is reported, not guessed", () => {
  const result = computeCampaignPerformance({
    ...base, days: [day({ utm_campaign: "spring" })],
    adCampaigns: [{ platform: "meta", campaignId: "9", campaignName: "Totally different", spend: 80 }, { platform: "meta", campaignId: "10", campaignName: "Orphan", spend: 20 }],
    mappings: [{ campaignId: "9", source: "facebook", medium: "paid_social", campaign: "spring" }],
  });
  assert.equal(result.rows[0].spend, 80);
  assert.equal(result.rows[0].spendLink, "manual");
  assert.equal(result.coverage.unmatched[0].spend, 20);
});

test("spend shared across mediums of one campaign splits by sales", () => {
  const result = computeCampaignPerformance({
    ...base,
    days: [day({ net_sales: 300 }), day({ utm_medium: "cpc", net_sales: 100 })],
    adCampaigns: [{ platform: "meta", campaignId: "1", campaignName: "summer_sale", spend: 100 }],
  });
  assert.deepEqual(result.rows.map((row) => row.spend), [75, 25]);
});

test("untagged share, platform roas and blended roas", () => {
  const result = computeCampaignPerformance({
    ...base,
    days: [day(), day({ utm_source: "", utm_medium: "", utm_campaign: "", net_sales: 200 })],
    platformSpend: [{ platform: "meta", date: "2026-07-06", spend: 100 }],
  });
  assert.equal(result.totals.untaggedShare, 0.5);
  assert.equal(result.platforms[0].roas, 2);
  assert.equal(result.totals.blendedRoas, 4);
  assert.equal(result.totals.taggedRoas, 2);
});

test("normalizeName ignores case and punctuation", () => {
  assert.equal(normalizeName(" Summer-Sale 2026! "), "summer_sale_2026");
});

test("parseCampaignRows drops empty rows, normalises and merges duplicate keys", () => {
  const ctx = { organizationId: "o", storeId: "s", currency: "GBP", now: "2026-07-10T00:00:00Z" };
  const row = (extra) => ({ day: "2026-07-06", order_utm_source: "Facebook", order_utm_medium: "Paid_Social", order_utm_campaign: "Summer", new_or_returning_customer: "New", orders: "1", net_sales: "£1,010.50", ...extra });
  const rows = parseCampaignRows([row({}), row({ order_utm_source: "facebook " }), row({ orders: "0", net_sales: "0", order_utm_campaign: "empty" }), row({ day: "bad" }), row({ order_utm_source: "", order_utm_medium: "", order_utm_campaign: "", new_or_returning_customer: "" })], ctx);
  assert.equal(rows.length, 2);
  const tagged = rows.find((item) => item.utm_source === "facebook");
  assert.equal(tagged.customer_type, "new");
  assert.equal(tagged.orders, 2);
  assert.equal(tagged.net_sales, 2021);
  const untagged = rows.find((item) => item.utm_source === "");
  assert.equal(untagged.customer_type, "unknown");
});

test("dateWindows covers the range newest first without gaps", () => {
  const windows = dateWindows("2026-01-01", "2026-01-10", 4);
  assert.deepEqual(windows, [{ from: "2026-01-07", to: "2026-01-10" }, { from: "2026-01-03", to: "2026-01-06" }, { from: "2026-01-01", to: "2026-01-02" }]);
});

test("campaignQuery asks for the daily UTM breakdown", () => {
  const query = campaignQuery("2026-01-01", "2026-01-31");
  assert.match(query, /FROM sales/);
  assert.match(query, /GROUP BY order_utm_source, order_utm_medium, order_utm_campaign, new_or_returning_customer/);
  assert.match(query, /TIMESERIES day/);
});
