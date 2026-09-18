export type CostCadence = "one_off" | "daily" | "weekly" | "monthly" | "annual";
export type CostAllocationBasis = "fixed" | "orders" | "units" | "revenue";
export type OperatingCostBucket = "shipping" | "handling" | "operating";

export function operatingCostBucket(category: string): OperatingCostBucket {
  if (category === "fulfilment") return "shipping";
  if (category === "handling" || category === "pick_pack") return "handling";
  return "operating";
}

type AllocationInput = {
  amount: number;
  cadence: CostCadence;
  basis: CostAllocationBasis;
  activeDays: number;
  orderCount: number;
  unitCount: number;
  revenue: number;
  oneOffInRange: boolean;
};

export function allocatePeriodCost(input: AllocationInput) {
  if (!Number.isFinite(input.amount) || input.amount < 0) return 0;
  if (input.basis === "orders") return input.amount * Math.max(input.orderCount, 0);
  if (input.basis === "units") return input.amount * Math.max(input.unitCount, 0);
  if (input.basis === "revenue") return input.amount / 100 * Math.max(input.revenue, 0);
  if (input.cadence === "one_off") return input.oneOffInRange ? input.amount : 0;
  const dailyRate = input.cadence === "daily" ? input.amount : input.cadence === "weekly" ? input.amount / 7 : input.cadence === "monthly" ? input.amount / 30.4375 : input.amount / 365.25;
  return dailyRate * Math.max(input.activeDays, 0);
}
