export type CustomSpendRow = {
  date: string;
  source: string;
  medium: string;
  campaign: string;
  spend: number;
  currency: string;
  account: string | null;
  adGroup: string | null;
  externalId: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum: number, required = false) => {
  if (value === undefined || value === null || value === "") return required ? undefined : null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length > maximum || (required && !normalized)) return undefined;
  return normalized || null;
};
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function parseCustomSpendImport(value: unknown): Result<{ filename: string; rows: CustomSpendRow[] }> {
  if (!record(value) || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 1000) {
    return { ok: false, error: "Import between 1 and 1,000 spend rows at a time" };
  }
  const filename = text(value.filename, 255, true);
  if (!filename) return { ok: false, error: "A source filename is required" };
  const rows: CustomSpendRow[] = [];
  for (let index = 0; index < value.rows.length; index += 1) {
    const input = value.rows[index];
    if (!record(input)) return { ok: false, error: `Row ${index + 1} is not valid` };
    const date = text(input.date, 10, true);
    const source = text(input.source, 100, true);
    const medium = text(input.medium, 100) ?? "(none)";
    const campaign = text(input.campaign, 255) ?? "(not set)";
    const currencyValue = text(input.currency, 3, true);
    const currency = currencyValue?.toUpperCase();
    const account = text(input.account, 255);
    const adGroup = text(input.adGroup, 255);
    const externalId = text(input.externalId, 255);
    const numericSpend = typeof input.spend === "number" ? input.spend : typeof input.spend === "string" ? Number(input.spend.replace(/[^0-9.-]/g, "")) : Number.NaN;
    if (!date || !validDate(date)) return { ok: false, error: `Row ${index + 1} needs a valid YYYY-MM-DD date` };
    if (!source) return { ok: false, error: `Row ${index + 1} needs a source` };
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: `Row ${index + 1} needs a three-letter currency` };
    if (!Number.isFinite(numericSpend) || numericSpend < 0 || numericSpend > 1_000_000_000_000) return { ok: false, error: `Row ${index + 1} needs a non-negative spend amount` };
    if ([medium, campaign, account, adGroup, externalId].some((item) => item === undefined)) return { ok: false, error: `Row ${index + 1} contains a value that is too long` };
    rows.push({ date, source, medium, campaign, spend: numericSpend, currency, account: account ?? null, adGroup: adGroup ?? null, externalId: externalId ?? null });
  }
  return { ok: true, value: { filename, rows } };
}
