import assert from "node:assert/strict";
import test from "node:test";
import { buildPnlExport, formatPnlValue } from "../lib/exports/pnl.ts";
import { buildXlsx } from "../lib/exports/xlsx.ts";

test("P&L export preserves precision, comparison and supplied period totals without summing them", () => {
  const report = buildPnlExport({
    currency: "GBP", metadata: [["Period", "2026-01-01 to 2026-02-28"]],
    columns: ["Jan 2026", "Feb 2026", "Previous period", "Total for period"],
    groups: [
      { heading: "Sales", rows: [{ label: "Net sales", format: "currency", values: [1234.56, 789.12, 1800, 2023.68] }] },
      { heading: "KPIs", rows: [
        { label: "Net margin", format: "percentage", values: [0.42345, null, 0.3, "Not shown"] },
        { label: "ROAS", format: "multiple", values: [7.512, 4.2, 5, "Not shown"] },
        { label: "Customers", format: "integer", values: [100, 110, 200, "Not shown"] },
        { label: "Items per order", format: "decimal", values: [1.123, 1.2, 1, "Not shown"] },
      ] },
    ],
  });
  assert.deepEqual(report.rows[4], ["Net sales", 1234.56, 789.12, 1800, 2023.68]);
  assert.deepEqual(report.csvRows[4], ["Net sales", "£1,235", "£789", "£1,800", "£2,024"]);
  assert.deepEqual(report.rows[6], ["Net margin", 0.42345, "—", 0.3, "Not shown"]);
  const xml = new TextDecoder().decode(buildXlsx(report.rows, report.options));
  assert.match(xml, /<c r="B5" s="2"><v>1234.56<\/v>/);
  assert.match(xml, /<c r="E5" s="2"><v>2023.68<\/v>/);
  assert.match(xml, /<c r="B7" s="3"><v>0.42345<\/v>/);
  assert.match(xml, /<c r="B8" s="6"><v>7.512<\/v>/);
  assert.match(xml, /<c r="B9" s="4"><v>100<\/v>/);
  assert.match(xml, /<c r="B10" s="5"><v>1.123<\/v>/);
  assert.match(xml, /formatCode="&quot;GBP &quot;#,##0.00"/);
  assert.match(xml, /width="42"/);
  assert.match(xml, /ySplit="3"/);
  assert.doesNotMatch(xml, /<autoFilter/);
});

test("missing values stay distinct from zero and text never becomes an Excel formula", () => {
  const report = buildPnlExport({ currency: "EUR", metadata: [], columns: ["Total"], groups: [
    { heading: "Costs", rows: [
      { label: "Fees", format: "currency", values: ["Not available"] },
      { label: "Cost", format: "currency", values: [-12.34] },
      { label: "Zero", format: "currency", values: [0] },
      { label: "Unknown", format: "currency", values: [NaN] },
      { label: "=HYPERLINK(\"example\")", format: "currency", values: [1] },
    ] },
  ] });
  assert.equal(report.rows[3][1], "Not available");
  assert.equal(report.rows[4][1], -12.34);
  assert.equal(report.rows[5][1], 0);
  assert.equal(report.rows[6][1], "—");
  const xml = new TextDecoder().decode(buildXlsx(report.rows, report.options));
  assert.doesNotMatch(xml, /<f>/);
  assert.match(xml, /<c r="B6" s="2"><v>0<\/v>/);
  assert.equal(formatPnlValue(0, "percentage", "EUR"), "0.0%");
  assert.equal(formatPnlValue(null, "multiple", "EUR"), "—");
  assert.equal(formatPnlValue(1.234, "decimal", "EUR"), "1.2");
});
