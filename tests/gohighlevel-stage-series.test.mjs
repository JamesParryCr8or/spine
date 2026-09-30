import test from "node:test";
import assert from "node:assert/strict";
import { getReachedPipelineStages } from "../lib/analytics/gohighlevel-stage-series.ts";

const selected = [
  { pipelineId: "sales", stageId: "lead", position: 0 },
  { pipelineId: "sales", stageId: "booked", position: 2 },
  { pipelineId: "sales", stageId: "won", position: 4 },
];

test("a later opportunity contributes to each selected stage line it has reached", () => {
  assert.deepEqual(getReachedPipelineStages("sales", "won", 4, selected, true), selected);
});

test("without later-stage inclusion, only the exact selected stage gets a count", () => {
  assert.deepEqual(getReachedPipelineStages("sales", "won", 4, selected, false), [selected[2]]);
});

test("stages from another pipeline are never included", () => {
  assert.deepEqual(getReachedPipelineStages("other", "won", 4, selected, true), []);
});
