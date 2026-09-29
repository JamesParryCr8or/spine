import test from "node:test";
import assert from "node:assert/strict";
import { calculateJourneyCounts } from "../lib/analytics/lead-funnel.ts";

const stagePositions = new Map([["lead", 0], ["booked", 1], ["purchase", 2], ["later", 3]]);
const milestones = { leadStageId: "lead", bookedCallStageId: "booked", purchaseStageId: "purchase" };

test("counts opportunities that have progressed through each configured funnel milestone", () => {
  const opportunities = [
    { pipelineStageId: "lead", status: "open" },
    { pipelineStageId: "booked", status: "open" },
    { pipelineStageId: "later", status: "open" },
    { pipelineStageId: "booked", status: "won" },
  ];
  assert.deepEqual(calculateJourneyCounts(opportunities, stagePositions, milestones), {
    leads: 4,
    bookedCalls: 3,
    purchases: 2,
  });
});

test("retains lost opportunities in earlier milestones but excludes them from purchases", () => {
  const opportunities = [
    { pipelineStageId: "booked", status: "lost" },
    { pipelineStageId: "later", status: "abandoned" },
    { pipelineStageId: "unknown", status: "open" },
  ];
  assert.deepEqual(calculateJourneyCounts(opportunities, stagePositions, milestones), {
    leads: 2,
    bookedCalls: 2,
    purchases: 0,
  });
});

test("returns empty counts when a selected milestone no longer belongs to the pipeline", () => {
  assert.deepEqual(calculateJourneyCounts([], stagePositions, { ...milestones, purchaseStageId: "removed" }), {
    leads: 0,
    bookedCalls: 0,
    purchases: 0,
  });
});
