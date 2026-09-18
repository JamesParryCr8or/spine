const currencyDigits: Record<string, number> = { BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3, CLP: 0, JPY: 0, KRW: 0 };

export function fractionDigits(currency: string) {
  return currencyDigits[currency.toUpperCase()] ?? 2;
}

export function roundCurrency(amount: number, currency: string) {
  if (!Number.isFinite(amount)) throw new Error("Money amount must be finite");
  const scale = 10 ** fractionDigits(currency);
  return Math.round((amount + Number.EPSILON) * scale) / scale;
}

export function convertCurrency(amount: number, exchangeRate: number, targetCurrency: string) {
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Exchange rate must be positive");
  return roundCurrency(amount * exchangeRate, targetCurrency);
}

export function sumSingleCurrency(values: Array<{ amount: number; currency: string }>, expectedCurrency: string) {
  const normalized = expectedCurrency.toUpperCase();
  if (values.some((value) => value.currency.toUpperCase() !== normalized)) throw new Error("Currency conversion is required before aggregation");
  return roundCurrency(values.reduce((total, value) => total + value.amount, 0), normalized);
}
