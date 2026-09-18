import assert from "node:assert/strict";
import test from "node:test";

import { parseCreateReport } from "../lib/reports/schema.ts";

test("validates and preserves a saved UTM report view", () => {
  const result = parseCreateReport({
    name: "Paid social",
    reportType: "utm",
    visibility: "private",
    datePreset: "all_imported",
    utmFilters: {
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      source: "facebook",
      medium: "paid_social",
      campaign: "summer_sale",
      landingPage: "/collections/summer",
      customerType: "New",
      country: "GB",
      product: "Running shoe",
      comparisonMode: "previous_year",
      attributionModel: "last_touch",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.utmFilters?.campaign, "summer_sale");
  assert.equal(result.value.utmFilters?.comparisonMode, "previous_year");
});

test("rejects malformed or misplaced UTM report filters", () => {
  assert.equal(parseCreateReport({
    name: "Bad date",
    reportType: "utm",
    utmFilters: { fromDate: "August", toDate: "", source: "all", medium: "all", campaign: "all", landingPage: "all", customerType: "all", country: "all", product: "all" },
  }).ok, false);
  assert.equal(parseCreateReport({
    name: "Wrong report",
    reportType: "pnl",
    utmFilters: { fromDate: "", toDate: "", source: "all", medium: "all", campaign: "all", landingPage: "all", customerType: "all", country: "all", product: "all" },
  }).ok, false);
});
