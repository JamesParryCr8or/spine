export type ShopifyTransactionFee = {
  fee_amount: string;
  fee_tax: string;
  currency: string;
  status: string;
};

export type PaymentFeeRule = {
  percentageRate: number;
  fixedFee: number;
  taxRate: number;
  minimumFee: number;
};

export type EffectivePaymentFeeRule = PaymentFeeRule & {
  gateway: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const monetary = (value: string) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

export function actualTransactionFees(transactions: ShopifyTransactionFee[], reportingCurrency: string) {
  return transactions
    .filter((transaction) => transaction.status === "SUCCESS" && transaction.currency === reportingCurrency)
    .reduce((total, transaction) => total + monetary(transaction.fee_amount) + monetary(transaction.fee_tax), 0);
}

export function estimatedTransactionFee(transactionAmount: number, rule: PaymentFeeRule) {
  if (!Number.isFinite(transactionAmount) || transactionAmount <= 0) return 0;
  const percentageRate = Number.isFinite(rule.percentageRate) ? Math.max(rule.percentageRate, 0) : 0;
  const fixedFee = Number.isFinite(rule.fixedFee) ? Math.max(rule.fixedFee, 0) : 0;
  const taxRate = Number.isFinite(rule.taxRate) ? Math.max(rule.taxRate, 0) : 0;
  const minimumFee = Number.isFinite(rule.minimumFee) ? Math.max(rule.minimumFee, 0) : 0;
  const feeBeforeTax = Math.max(transactionAmount * percentageRate / 100 + fixedFee, minimumFee);
  return feeBeforeTax * (1 + taxRate / 100);
}

export function selectEffectivePaymentFeeRule(rules: EffectivePaymentFeeRule[], gateway: string | null, currency: string, processedAt: string | null) {
  if (!gateway || !processedAt) return null;
  const normalizedGateway = gateway.trim().toLowerCase();
  const date = processedAt.slice(0, 10);
  return rules
    .filter((rule) => rule.gateway.trim().toLowerCase() === normalizedGateway && rule.currency === currency && rule.effectiveFrom <= date && (!rule.effectiveTo || rule.effectiveTo >= date))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] ?? null;
}
