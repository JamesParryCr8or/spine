type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const currencyPattern = /^[A-Z]{3}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseExchangeRate(value: unknown): ValidationResult<{ baseCurrency: string; quoteCurrency: string; rate: string; effectiveDate: string; notes: string | null }> {
  if (!isRecord(value)) return { ok: false, error: "Use a valid exchange-rate definition" };
  const baseCurrency = typeof value.baseCurrency === "string" ? value.baseCurrency.trim().toUpperCase() : "";
  const quoteCurrency = typeof value.quoteCurrency === "string" ? value.quoteCurrency.trim().toUpperCase() : "";
  const rate = typeof value.rate === "number" ? String(value.rate) : typeof value.rate === "string" ? value.rate.trim() : "";
  const effectiveDate = typeof value.effectiveDate === "string" ? value.effectiveDate.trim() : "";
  const notes = value.notes === undefined || value.notes === null || value.notes === "" ? null : typeof value.notes === "string" ? value.notes.trim() : undefined;
  if (!currencyPattern.test(baseCurrency) || !currencyPattern.test(quoteCurrency) || baseCurrency === quoteCurrency) {
    return { ok: false, error: "Choose two different three-letter currency codes" };
  }
  if (!decimalPattern.test(rate) || Number(rate) <= 0) return { ok: false, error: "Enter a positive exchange rate with up to 10 decimal places" };
  if (!datePattern.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) return { ok: false, error: "Choose a valid effective date" };
  if (notes === undefined || notes.length > 500) return { ok: false, error: "Keep exchange-rate notes under 500 characters" };
  return { ok: true, value: { baseCurrency, quoteCurrency, rate, effectiveDate, notes } };
}

export function parseExchangeRateId(value: unknown): ValidationResult<{ id: string }> {
  if (typeof value !== "string" || !uuidPattern.test(value)) return { ok: false, error: "A valid exchange-rate id is required" };
  return { ok: true, value: { id: value } };
}
