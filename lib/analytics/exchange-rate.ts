export type DatedExchangeRate = {
  base_currency: string;
  quote_currency: string;
  rate: string;
  effective_date: string;
};

const normalizedCurrency = (currency: string | null | undefined) => currency?.trim().toUpperCase() || "UNKNOWN";

export function resolveDatedExchangeRate(
  rates: DatedExchangeRate[],
  sourceCurrency: string | null | undefined,
  reportingCurrency: string,
  occurredAt: string,
) {
  const source = normalizedCurrency(sourceCurrency);
  const target = normalizedCurrency(reportingCurrency);
  if (source === target) return 1;
  const date = occurredAt.slice(0, 10);
  const match = rates
    .filter((rate) => normalizedCurrency(rate.base_currency) === source && normalizedCurrency(rate.quote_currency) === target && rate.effective_date <= date)
    .sort((left, right) => right.effective_date.localeCompare(left.effective_date))[0];
  if (!match) return null;
  const value = Number(match.rate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function convertDatedAmount(amount: number, exchangeRate: number, reportingCurrency: string) {
  if (!Number.isFinite(amount)) throw new Error("Money amount must be finite");
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Exchange rate must be positive");
  const threeDecimalCurrencies = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);
  const zeroDecimalCurrencies = new Set(["CLP", "JPY", "KRW"]);
  const currency = reportingCurrency.toUpperCase();
  const digits = threeDecimalCurrencies.has(currency) ? 3 : zeroDecimalCurrencies.has(currency) ? 0 : 2;
  const scale = 10 ** digits;
  return Math.round((amount * exchangeRate + Number.EPSILON) * scale) / scale;
}
