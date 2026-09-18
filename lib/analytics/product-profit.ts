type ProductProfitInput = {
  grossSales: number;
  discounts: number;
  refunds: number;
  cogs: number;
  shippingCosts: number;
  handlingCosts: number;
  transactionFees: number;
  marketingAllocation: number;
  costCoverageComplete: boolean;
};

export function calculateProductProfit(input: ProductProfitInput) {
  const salesAfterDiscounts = input.grossSales - input.discounts;
  const netRevenue = salesAfterDiscounts - input.refunds;
  const grossProfit = netRevenue - input.cogs;
  const contributionProfit = grossProfit - input.shippingCosts - input.handlingCosts - input.transactionFees - input.marketingAllocation;
  return {
    netRevenue,
    grossProfit,
    grossMargin: input.costCoverageComplete && netRevenue ? grossProfit / netRevenue : null,
    contributionProfit,
    contributionMargin: input.costCoverageComplete && netRevenue ? contributionProfit / netRevenue : null,
  };
}
