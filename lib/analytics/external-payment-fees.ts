import { estimatedTransactionFee, selectEffectivePaymentFeeRule, type EffectivePaymentFeeRule } from "./transaction-fees.ts";

export type GatewayPaymentDay = { payment_date: string; gateway: string; gross_payments: string | number; transactions: number; currency: string };
export type PaymentEstimateSettings = { shopify_plan: string | null; plan_override: string | null; default_percentage_rate: string | number; default_fixed_fee: string | number; surcharge_rate_override: string | number | null };

const noProcessorFeeGateways = new Set(["shopify payments", "shopify_payments", "shopify pay", "shopify_pay", "shop pay installments", "gift card", "gift_card", "cash", "manual", "bank deposit", "bank transfer", "money order"]);

export function isExternalProcessor(gateway: string) {
  const normalized = gateway.trim().toLowerCase();
  return Boolean(normalized) && !noProcessorFeeGateways.has(normalized);
}

export function shopifyThirdPartyRate(plan: string | null | undefined) {
  const normalized = plan?.trim().toLowerCase();
  if (normalized === "basic") return 2;
  if (normalized === "grow") return 1;
  if (normalized === "advanced") return 0.6;
  if (normalized === "plus" || normalized === "plus trial") return 0.2;
  return null;
}

export function calculateExternalPaymentFees(days: GatewayPaymentDay[], rules: EffectivePaymentFeeRule[], settings: PaymentEstimateSettings | null, currency: string) {
  const defaultPercentage = Number(settings?.default_percentage_rate ?? 2);
  const defaultFixed = Number(settings?.default_fixed_fee ?? (currency === "GBP" ? 0.23 : 0.25));
  const plan = settings?.plan_override || settings?.shopify_plan || null;
  const surchargeRate = settings?.surcharge_rate_override == null
    ? shopifyThirdPartyRate(plan) : Number(settings.surcharge_rate_override);
  const shopifyPaymentsPresent = days.some((day) => ["shopify payments", "shopify_payments"].includes(day.gateway.trim().toLowerCase()) && day.transactions > 0);
  let processorFees = 0;
  let shopifySurcharge = 0;
  let transactions = 0;
  const byGateway = new Map<string, { payments: number; transactions: number; processorFees: number; shopifySurcharge: number }>();
  for (const day of days) {
    if (day.currency !== currency || !isExternalProcessor(day.gateway)) continue;
    const payments = Math.max(0, Number(day.gross_payments) || 0);
    const count = Math.max(0, Math.trunc(Number(day.transactions) || 0));
    if (!payments || !count) continue;
    const rule = selectEffectivePaymentFeeRule(rules, day.gateway, currency, day.payment_date);
    const processor = estimatedTransactionFee(payments / count, rule ?? {
      percentageRate: defaultPercentage, fixedFee: defaultFixed, taxRate: 0, minimumFee: 0,
    }) * count;
    // Shopify waives its third-party charge on PayPal Express when Shopify Payments is in use.
    const paypalExpressWaived = shopifyPaymentsPresent && /paypal express checkout/i.test(day.gateway);
    const surcharge = surchargeRate === null || paypalExpressWaived ? 0 : payments * surchargeRate / 100;
    processorFees += processor;
    shopifySurcharge += surcharge;
    transactions += count;
    const previous = byGateway.get(day.gateway) ?? { payments: 0, transactions: 0, processorFees: 0, shopifySurcharge: 0 };
    byGateway.set(day.gateway, { payments: previous.payments + payments, transactions: previous.transactions + count,
      processorFees: previous.processorFees + processor, shopifySurcharge: previous.shopifySurcharge + surcharge });
  }
  return { processorFees, shopifySurcharge, transactions, plan, surchargeRate,
    byGateway: [...byGateway].map(([gateway, values]) => ({ gateway, ...values })).sort((a, b) => b.payments - a.payments) };
}
