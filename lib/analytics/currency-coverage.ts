export type CurrencyCoverageSummary = {
  reportingCurrency: string;
  includedOrders: number;
  excludedOrders: number;
  excludedCurrencies: Array<{ currency: string; orders: number }>;
};

export function createCurrencyCoverage(reportingCurrency: string) {
  const normalizedReportingCurrency = reportingCurrency.trim().toUpperCase();
  let includedOrders = 0;
  let excludedOrders = 0;
  const excluded = new Map<string, number>();
  return {
    include(currency: string | null | undefined) {
      const normalized = currency?.trim().toUpperCase() || "UNKNOWN";
      if (normalized === normalizedReportingCurrency) { includedOrders += 1; return true; }
      excludedOrders += 1;
      excluded.set(normalized, (excluded.get(normalized) ?? 0) + 1);
      return false;
    },
    summary(): CurrencyCoverageSummary {
      return { reportingCurrency: normalizedReportingCurrency, includedOrders, excludedOrders, excludedCurrencies: [...excluded.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, orderCount]) => ({ currency, orders: orderCount })) };
    },
  };
}
