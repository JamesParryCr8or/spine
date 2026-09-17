export type EffectiveCost = {
  variant_id: string | null;
  sku: string | null;
  amount: string;
  effective_from: string;
  effective_to: string | null;
  source: string;
};

const sourcePriority: Record<string, number> = { manual: 4, csv: 3, google_sheets: 2, shopify: 1 };

export function monetary(value: string | number | null | undefined) {
  return Number(value) || 0;
}

export function resolveEffectiveCost(costs: EffectiveCost[], orderDate: string, fallback: number | null) {
  const applicable = costs
    .filter((cost) => cost.effective_from <= orderDate && (!cost.effective_to || cost.effective_to >= orderDate))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from) || (sourcePriority[right.source] ?? 0) - (sourcePriority[left.source] ?? 0));
  return applicable.length ? monetary(applicable[0].amount) : fallback;
}

export function costKey(cost: Pick<EffectiveCost, "variant_id" | "sku">) {
  return cost.variant_id ? `variant:${cost.variant_id}` : cost.sku ? `sku:${cost.sku.trim().toLowerCase()}` : null;
}
