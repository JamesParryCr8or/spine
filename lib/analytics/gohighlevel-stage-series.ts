export type SelectedPipelineStage = {
  pipelineId: string;
  stageId: string;
  position: number;
};

export function getReachedPipelineStages(
  pipelineId: string,
  currentStageId: string,
  currentPosition: number | undefined,
  selections: SelectedPipelineStage[],
  includeLaterStages: boolean,
) {
  return selections.filter((selection) => selection.pipelineId === pipelineId && (
    selection.stageId === currentStageId
    || (includeLaterStages && currentPosition !== undefined && currentPosition >= selection.position)
  ));
}
