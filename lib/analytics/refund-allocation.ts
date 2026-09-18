export type RefundAllocationLine = {
  key: string;
  netSales: number;
  explicitRefund: number;
};

export function allocateOrderRefund(totalRefund: number, lines: RefundAllocationLine[]) {
  const safeTotal = Number.isFinite(totalRefund) ? Math.max(totalRefund, 0) : 0;
  const explicitTotal = lines.reduce((total, line) => total + Math.max(Number.isFinite(line.explicitRefund) ? line.explicitRefund : 0, 0), 0);
  const residual = Math.max(safeTotal - explicitTotal, 0);
  const weights = lines.map((line) => Math.max((Number.isFinite(line.netSales) ? line.netSales : 0) - Math.max(line.explicitRefund, 0), 0));
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  return new Map(lines.map((line, index) => [line.key, Math.max(line.explicitRefund, 0) + (weightTotal > 0 ? residual * weights[index] / weightTotal : 0)]));
}
