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


export type CurrencyConversionCoverageSummary = {
  reportingCurrency: string;
  includedRows: number;
  convertedRows: number;
  excludedRows: number;
  convertedCurrencies: Array<{ currency: string; rows: number }>;
  excludedCurrencies: Array<{ currency: string; rows: number }>;
};

export function createCurrencyConversionCoverage(reportingCurrency: string) {
  const reporting = normalizedCurrency(reportingCurrency);
  let includedRows = 0;
  let convertedRows = 0;
  let excludedRows = 0;
  const converted = new Map<string, number>();
  const excluded = new Map<string, number>();
  const rows = (values: Map<string, number>) => [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, rowCount]) => ({ currency, rows: rowCount }));
  return {
    include(currency: string | null | undefined, exchangeRate: number | null) {
      const source = normalizedCurrency(currency);
      if (exchangeRate === null || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        excludedRows += 1;
        excluded.set(source, (excluded.get(source) ?? 0) + 1);
        return false;
      }
      includedRows += 1;
      if (source !== reporting) {
        convertedRows += 1;
        converted.set(source, (converted.get(source) ?? 0) + 1);
      }
      return true;
    },
    summary(): CurrencyConversionCoverageSummary {
      return {
        reportingCurrency: reporting,
        includedRows,
        convertedRows,
        excludedRows,
        convertedCurrencies: rows(converted),
        excludedCurrencies: rows(excluded),
      };
    },
  };
}
