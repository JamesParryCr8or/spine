export type JourneyOpportunity = { pipelineStageId?: string | null; status?: string | null };
export type JourneyStageMap = { leadStageId: string; bookedCallStageId: string; purchaseStageId: string };

export function calculateJourneyCounts(
  opportunities: JourneyOpportunity[],
  stagePositions: Map<string, number>,
  milestones: JourneyStageMap,
) {
  const leadPosition = stagePositions.get(milestones.leadStageId);
  const bookedPosition = stagePositions.get(milestones.bookedCallStageId);
  const purchasePosition = stagePositions.get(milestones.purchaseStageId);
  if (leadPosition === undefined || bookedPosition === undefined || purchasePosition === undefined) {
    return { leads: 0, bookedCalls: 0, purchases: 0 };
  }

  return opportunities.reduce((counts, opportunity) => {
    const position = stagePositions.get(opportunity.pipelineStageId ?? "");
    if (position === undefined) return counts;
    const status = (opportunity.status ?? "").toLowerCase();
    if (position >= leadPosition) counts.leads += 1;
    if (position >= bookedPosition) counts.bookedCalls += 1;
    if (status === "won" || (status !== "lost" && status !== "abandoned" && position >= purchasePosition)) counts.purchases += 1;
    return counts;
  }, { leads: 0, bookedCalls: 0, purchases: 0 });
}
