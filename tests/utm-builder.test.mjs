import assert from "node:assert/strict";
import test from "node:test";

import { buildCampaignUrl, normalizeUtmValue } from "../lib/analytics/utm-builder.ts";

test("normalizes UTM names consistently", () => {
  assert.equal(normalizeUtmValue("  Summer Sale – UK  "), "summer_sale_uk");
  assert.equal(normalizeUtmValue("Paid Social"), "paid_social");
  assert.equal(normalizeUtmValue("Crème Brûlée"), "creme_brulee");
});

test("builds a campaign URL without discarding existing parameters or fragments", () => {
  const result = buildCampaignUrl("https://example.com/products/widget?variant=blue#details", {
    source: "Meta Ads",
    medium: "Paid Social",
    campaign: "Summer Sale UK",
    content: "Carousel A",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const url = new URL(result.url);
  assert.equal(url.searchParams.get("variant"), "blue");
  assert.equal(url.searchParams.get("utm_source"), "meta_ads");
  assert.equal(url.searchParams.get("utm_medium"), "paid_social");
  assert.equal(url.searchParams.get("utm_campaign"), "summer_sale_uk");
  assert.equal(url.searchParams.get("utm_content"), "carousel_a");
  assert.equal(url.hash, "#details");
});

test("rejects invalid URLs and missing required UTM dimensions", () => {
  assert.deepEqual(buildCampaignUrl("not a URL", { source: "meta", medium: "paid", campaign: "launch" }), { ok: false, error: "Enter a complete URL beginning with https://" });
  assert.deepEqual(buildCampaignUrl("https://example.com", { source: "", medium: "paid", campaign: "launch" }), { ok: false, error: "Source, medium, and campaign are required" });
  assert.deepEqual(buildCampaignUrl("javascript:alert(1)", { source: "meta", medium: "paid", campaign: "launch" }), { ok: false, error: "Campaign URLs must use http or https" });
});
