export type ProductShippingCost = {
  id: string;
  variant_id: string | null;
  sku: string | null;
  amount: string;
  allocation_basis: "orders" | "units";
  effective_from: string;
  effective_to: string | null;
};

export function selectEffectiveShippingCost(costs: ProductShippingCost[], orderDate: string) {
  return costs
    .filter((cost) => cost.effective_from <= orderDate && (!cost.effective_to || cost.effective_to >= orderDate))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}

export type ShippingCoverage = "override" | "fallback" | "missing";

export function summarizeShippingCoverage(coverage: ShippingCoverage[]) {
  const overrideLines = coverage.filter((value) => value === "override").length;
  const fallbackLines = coverage.filter((value) => value === "fallback").length;
  const missingLines = coverage.filter((value) => value === "missing").length;
  const coveredLines = overrideLines + fallbackLines;
  return {
    overrideLines,
    fallbackLines,
    missingLines,
    fallbackRate: coveredLines ? fallbackLines / coveredLines : null,
  };
}
