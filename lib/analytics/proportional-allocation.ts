export function proportionalAllocations(total: number, weights: Map<string, number>) {
  const safeTotal = Number.isFinite(total) ? Math.max(total, 0) : 0;
  const safeWeights = [...weights].map(([key, value]) => [key, Number.isFinite(value) ? Math.max(value, 0) : 0] as const);
  const weightTotal = safeWeights.reduce((sum, [, value]) => sum + value, 0);
  return new Map(safeWeights.map(([key, value]) => [key, weightTotal > 0 ? safeTotal * value / weightTotal : 0]));
}
