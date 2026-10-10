import assert from "node:assert/strict";
import test from "node:test";

import { computeCampaignPerformance, normalizeName, platformOf } from "../lib/analytics/campaign-performance.ts";
import { campaignQuery, dateWindows, parseCampaignRows } from "../lib/analytics/campaign-rows.ts";

const day = (extra = {}) => ({ sales_date: "2026-07-06", utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "summer_sale", customer_type: "new", last_click_orders: 0, last_click_sales: 0, last_non_direct_orders: 2, last_non_direct_sales: 200, first_click_orders: 0, first_click_sales: 0, ...extra });
const base = { model: "last_non_direct", platformSpend: [], adCampaigns: [], mappings: [], customSpend: [] };

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
    days: [day({ last_non_direct_sales: 300 }), day({ utm_medium: "cpc", last_non_direct_sales: 100 })],
    adCampaigns: [{ platform: "meta", campaignId: "1", campaignName: "summer_sale", spend: 100 }],
  });
  assert.deepEqual(result.rows.map((row) => row.spend), [75, 25]);
});

test("attribution model picks its own measures", () => {
  const days = [day({ last_click_orders: 5, last_click_sales: 500 })];
  assert.equal(computeCampaignPerformance({ ...base, days, model: "last_click" }).totals.sales, 500);
  assert.equal(computeCampaignPerformance({ ...base, days, model: "last_non_direct" }).totals.sales, 200);
  assert.equal(computeCampaignPerformance({ ...base, days, model: "first_click" }).rows.length, 0);
});

test("untagged share, platform roas and blended roas", () => {
  const result = computeCampaignPerformance({
    ...base,
    days: [day(), day({ utm_source: "", utm_medium: "", utm_campaign: "", last_non_direct_sales: 200 })],
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
  const row = (extra) => ({ day: "2026-07-06", utm_source: "Facebook", utm_medium: "Paid_Social", utm_campaign: "Summer", new_or_returning_customer: "New", campaign_last_click_order_count: "1", campaign_last_click_total_sales: "£1,010.50", campaign_last_non_direct_click_order_count: "1", campaign_last_non_direct_click_total_sales: "10.00", campaign_first_click_order_count: "0", campaign_first_click_total_sales: "0", ...extra });
  const rows = parseCampaignRows([row({}), row({ utm_source: "facebook " }), row({ campaign_last_click_order_count: "0", campaign_last_click_total_sales: "0", campaign_last_non_direct_click_order_count: "0", campaign_last_non_direct_click_total_sales: "0", utm_campaign: "empty" }), row({ day: "bad" })], ctx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].utm_source, "facebook");
  assert.equal(rows[0].customer_type, "new");
  assert.equal(rows[0].last_click_orders, 2);
  assert.equal(rows[0].last_click_sales, 2021);
});

test("dateWindows covers the range newest first without gaps", () => {
  const windows = dateWindows("2026-01-01", "2026-01-10", 4);
  assert.deepEqual(windows, [{ from: "2026-01-07", to: "2026-01-10" }, { from: "2026-01-03", to: "2026-01-06" }, { from: "2026-01-01", to: "2026-01-02" }]);
});

test("campaignQuery asks for the daily UTM breakdown", () => {
  const query = campaignQuery("2026-01-01", "2026-01-31");
  assert.match(query, /FROM campaign_sales/);
  assert.match(query, /GROUP BY utm_source, utm_medium, utm_campaign, new_or_returning_customer/);
  assert.match(query, /TIMESERIES day/);
});
