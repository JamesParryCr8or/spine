import test from "node:test";
import assert from "node:assert/strict";
import { planStock, combinedDemand, defaultPlanning, csvText } from "../lib/stock/planning.ts";
const item = { id: "item", variantId: "v1", variantIds: ["v1"], tracked: true, levels: [{ id: "a", active: true, available: 10, incoming: 0, onHand: 12, committed: 2 }, { id: "b", active: true, available: 20, incoming: 0, onHand: 20, committed: 0 }] };
const demand = { variantId: "v1", sales30: 60, sales60: 120, sales90: 180, returns30: 0, returns60: 0, returns90: 0, net30: 60, net60: 120, net90: 180 };
test("consolidated demand is counted once across warehouses", () => {
  const plan = planStock(item, demand, "", defaultPlanning);
  assert.equal(plan.available, 30); assert.equal(plan.daily, 2); assert.equal(plan.reorder, 132);
});
test("warehouse demand share and incoming stock reduce the order", () => {
  const row = { ...item, levels: [{ ...item.levels[0], incoming: 20 }] };
  assert.equal(planStock(row, demand, "a", { ...defaultPlanning, share: 50 }).reorder, 0);
  assert.equal(planStock(row, demand, "a", { ...defaultPlanning, share: 50, incoming: false }).reorder, 71);
});
test("negative stock, minimums and case packs are handled", () => {
  const row = { ...item, levels: [{ ...item.levels[0], available: -5 }] };
  const plan = planStock(row, demand, "a", { ...defaultPlanning, minimum: 200, pack: 12 });
  assert.equal(plan.reorder, 204); assert.equal(plan.action, "Out of stock");
});
test("no demand, untracked and absent warehouse do not generate automatic orders", () => {
  assert.equal(planStock(item, undefined, "", defaultPlanning).reorder, 0);
  assert.equal(planStock({ ...item, tracked: false }, demand, "", defaultPlanning).reorder, 0);
  assert.equal(planStock(item, demand, "missing", defaultPlanning).reorder, 0);
});
test("shared inventory combines variant demand without duplicating physical units", () => {
  const row = { ...item, variantIds: ["v1", "v2"] };
  const combined = combinedDemand(row, new Map([["v1", demand], ["v2", { ...demand, variantId: "v2" }]]));
  assert.equal(combined.net30, 120);
  assert.equal(planStock(row, combined, "", defaultPlanning).available, 30);
});
test("CSV escapes quotes, commas and spreadsheet formulas", () => {
  assert.equal(csvText([["=HYPERLINK(1)", 'A, "B"', 12]]), '\uFEFF"\'=HYPERLINK(1)","A, ""B""","12"');
});
