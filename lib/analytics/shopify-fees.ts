export type ShopifyDailyFeeFields = {
  shopify_payments_processing_fees: number;
  foreign_exchange_fees: number;
  managed_markets_fees: number;
  international_fees: number;
  total_payment_fees: number;
};

export type ShopifyDailyFeeRow = Partial<Record<keyof ShopifyDailyFeeFields, string | number | null>>;

const amount = (value: string | number | null | undefined) => {
  const parsed = Number(typeof value === "string" ? value.replace(/[£$€,\s]/g, "") : value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Use fresh ShopifyQL values when present; keep imported values when that report omits the day. */
export function resolveShopifyDailyFees(
  reported: ShopifyDailyFeeRow | null,
  existing: ShopifyDailyFeeRow | null,
): ShopifyDailyFeeFields {
  const source = reported ?? existing;
  const processing = amount(source?.shopify_payments_processing_fees);
  const international = amount(source?.international_fees);
  return {
    shopify_payments_processing_fees: processing,
    foreign_exchange_fees: amount(source?.foreign_exchange_fees),
    managed_markets_fees: amount(source?.managed_markets_fees),
    international_fees: international,
    total_payment_fees: reported
      ? processing + international
      : amount(existing?.total_payment_fees) || processing + international,
  };
}
