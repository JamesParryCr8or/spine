import assert from "node:assert/strict";
import test from "node:test";

import { buildXlsx } from "../lib/exports/xlsx.ts";

test("builds a valid uncompressed XLSX package with escaped worksheet values", () => {
  const bytes = buildXlsx([
    ["Campaign", "Revenue", "Mix"],
    ["Summer & sale", 1250.5, 0.42],
  ], { sheetName: "UTM report", headerRow: 0, columnStyles: { 1: "currency", 2: "percentage" } });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const decoded = new TextDecoder().decode(bytes);
  assert.match(decoded, /xl\/worksheets\/sheet1\.xml/);
  assert.match(decoded, /Summer &amp; sale/);
  assert.match(decoded, /<c r="B2" s="2"><v>1250\.5<\/v><\/c>/);
  assert.match(decoded, /<c r="C2" s="3"><v>0\.42<\/v><\/c>/);
  assert.match(decoded, /<autoFilter ref="A1:C2"\/>/);
});

test("sanitizes invalid Excel sheet-name characters", () => {
  const decoded = new TextDecoder().decode(buildXlsx([["A"]], { sheetName: "UTM/Report:*?" }));
  assert.match(decoded, /<sheet name="UTM Report"/);
});
