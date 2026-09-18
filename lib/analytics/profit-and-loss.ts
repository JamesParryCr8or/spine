export type ProfitAndLossInput = {
  grossSales: number;
  discounts: number;
  netProductSales: number;
  shippingRevenue: number;
  tax: number;
  duties: number;
  totalSales: number;
  refunds: number;
  cogs: number;
  marketingSpend: number;
  transactionFees: number;
  merchantShippingCosts: number;
  handlingCosts: number;
  fixedOperatingExpenses: number;
  variableOperatingExpenses: number;
  complete: boolean;
};

export function calculateProfitAndLoss(input: ProfitAndLossInput) {
  const contributionRevenue = input.netProductSales - input.refunds;
  const grossProfit = contributionRevenue - input.cogs;
  const operatingExpenses = input.fixedOperatingExpenses + input.variableOperatingExpenses;
  const profitAfterOperatingCosts = grossProfit - operatingExpenses;
  const profitAfterKnownCosts = profitAfterOperatingCosts - input.transactionFees - input.merchantShippingCosts - input.handlingCosts;
  const profitAfterMarketingSpend = profitAfterKnownCosts - input.marketingSpend;
  const contributionMarginBeforeShipping = grossProfit - input.variableOperatingExpenses - input.transactionFees - input.marketingSpend;
  const contributionMargin = contributionMarginBeforeShipping - input.merchantShippingCosts - input.handlingCosts;
  const netProfit = input.complete ? profitAfterMarketingSpend : null;
  return {
    grossProfit,
    grossMargin: contributionRevenue ? grossProfit / contributionRevenue : null,
    operatingExpenses,
    profitAfterOperatingCosts,
    profitAfterKnownCosts,
    profitAfterMarketingSpend,
    contributionMarginBeforeShipping,
    contributionMarginBeforeShippingPercentage: contributionRevenue ? contributionMarginBeforeShipping / contributionRevenue : null,
    contributionMargin,
    contributionMarginPercentage: contributionRevenue ? contributionMargin / contributionRevenue : null,
    netProfit,
    netMargin: netProfit !== null && contributionRevenue ? netProfit / contributionRevenue : null,
  };
}
