import assert from "node:assert/strict";
import test from "node:test";

import { starterReports } from "../lib/reports/starter-templates.ts";
import { parseCreateReport } from "../lib/reports/schema.ts";

test("provides the available starter report set with valid definitions", () => {
  assert.deepEqual(starterReports.map((report) => report.name), [
    "Income statement",
    "Daily channel spend",
    "Product profitability",
    "New customer acquisition",
  ]);
  assert.equal(new Set(starterReports.map((report) => report.name)).size, starterReports.length);
  for (const report of starterReports) {
    const parsed = parseCreateReport({
      ...report,
      visibility: "private",
      ...(report.reportType === "utm" ? { utmFilters: null } : {}),
    });
    assert.equal(parsed.ok, true, report.name);
  }
});
