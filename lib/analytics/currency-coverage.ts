export type CurrencyCoverageSummary = {
  reportingCurrency: string;
  includedOrders: number;
  convertedOrders: number;
  excludedOrders: number;
  convertedCurrencies: Array<{ currency: string; orders: number }>;
  excludedCurrencies: Array<{ currency: string; orders: number }>;
};

export function createCurrencyCoverage(reportingCurrency: string) {
  const normalizedReportingCurrency = reportingCurrency.trim().toUpperCase();
  let includedOrders = 0;
  let convertedOrders = 0;
  let excludedOrders = 0;
  const converted = new Map<string, number>();
  const excluded = new Map<string, number>();
  return {
    include(currency: string | null | undefined, exchangeRate?: number | null) {
      const normalized = currency?.trim().toUpperCase() || "UNKNOWN";
      if (normalized === normalizedReportingCurrency) {
        includedOrders += 1;
        return true;
      }
      if (exchangeRate !== null && exchangeRate !== undefined && Number.isFinite(exchangeRate) && exchangeRate > 0) {
        includedOrders += 1;
        convertedOrders += 1;
        converted.set(normalized, (converted.get(normalized) ?? 0) + 1);
        return true;
      }
      excludedOrders += 1;
      excluded.set(normalized, (excluded.get(normalized) ?? 0) + 1);
      return false;
    },
    summary(): CurrencyCoverageSummary {
      const rows = (values: Map<string, number>) => [...values.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, orderCount]) => ({ currency, orders: orderCount }));
      return {
        reportingCurrency: normalizedReportingCurrency,
        includedOrders,
        convertedOrders,
        excludedOrders,
        convertedCurrencies: rows(converted),
        excludedCurrencies: rows(excluded),
      };
    },
  };
}
