import assert from "node:assert/strict";
import test from "node:test";

import { parseCustomSpendImport } from "../lib/settings/custom-spend-schema.ts";

test("normalizes a valid custom spend import", () => {
  assert.deepEqual(parseCustomSpendImport({
    filename: " channel-spend.csv ",
    rows: [{ date: "2026-09-01", source: " Meta ", medium: "", campaign: "", spend: "£1,250.50", currency: "gbp", account: "UK", adGroup: "Prospecting", externalId: "row-1" }],
  }), {
    ok: true,
    value: {
      filename: "channel-spend.csv",
      rows: [{ date: "2026-09-01", source: "Meta", medium: "(none)", campaign: "(not set)", spend: 1250.5, currency: "GBP", account: "UK", adGroup: "Prospecting", externalId: "row-1" }],
    },
  });
});

test("rejects invalid custom spend rows", () => {
  assert.equal(parseCustomSpendImport({ filename: "empty.csv", rows: [] }).ok, false);
  assert.equal(parseCustomSpendImport({ filename: "bad.csv", rows: [{ date: "2026-02-30", source: "meta", spend: 10, currency: "GBP" }] }).ok, false);
  assert.equal(parseCustomSpendImport({ filename: "bad.csv", rows: [{ date: "2026-09-01", source: "", spend: 10, currency: "GBP" }] }).ok, false);
  assert.equal(parseCustomSpendImport({ filename: "bad.csv", rows: [{ date: "2026-09-01", source: "meta", spend: -1, currency: "GBP" }] }).ok, false);
});
