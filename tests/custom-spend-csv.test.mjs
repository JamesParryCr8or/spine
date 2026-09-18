import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomSpendRows, parseCustomSpendCsv } from "../lib/settings/custom-spend-csv.ts";

test("infers common custom spend CSV headers", () => {
  const draft = parseCustomSpendCsv("Day,Platform,Amount Spent,Campaign Name\n2026-09-01,Meta,123.45,Prospecting", "spend.csv");
  assert.equal(draft.mapping.date, 0);
  assert.equal(draft.mapping.source, 1);
  assert.equal(draft.mapping.spend, 2);
  assert.equal(draft.mapping.campaign, 3);
  assert.deepEqual(buildCustomSpendRows(draft, draft.mapping, "GBP"), {
    ok: true,
    rows: [{
      date: "2026-09-01",
      source: "Meta",
      spend: "123.45",
      medium: "",
      campaign: "Prospecting",
      currency: "GBP",
      account: "",
      adGroup: "",
      externalId: "",
    }],
  });
});

test("supports manual mapping for non-standard headers", () => {
  const draft = parseCustomSpendCsv("When,Network,Investment\n2026-09-02,TikTok,£45.00", "custom.csv");
  assert.equal(draft.mapping.date, -1);
  const mapping = { ...draft.mapping, date: 0, source: 1, spend: 2 };
  const result = buildCustomSpendRows(draft, mapping, "EUR");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rows[0].source, "TikTok");
    assert.equal(result.rows[0].currency, "EUR");
  }
});

test("rejects missing and duplicate mappings", () => {
  const draft = parseCustomSpendCsv("When,Network,Investment\n2026-09-02,TikTok,45", "custom.csv");
  assert.equal(buildCustomSpendRows(draft, draft.mapping, "GBP").ok, false);
  const duplicate = { ...draft.mapping, date: 0, source: 1, spend: 1 };
  const result = buildCustomSpendRows(draft, duplicate, "GBP");
  assert.deepEqual(result, { ok: false, error: "Each CSV column can only be mapped once" });
});

test("parses quoted commas and escaped quotes", () => {
  const draft = parseCustomSpendCsv('date,source,spend,campaign\n2026-09-03,Meta,10,"Sale, ""Always On"""', "quoted.csv");
  const result = buildCustomSpendRows(draft, draft.mapping, "GBP");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.rows[0].campaign, 'Sale, "Always On"');
});
