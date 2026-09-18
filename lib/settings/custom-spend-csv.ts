export type CustomSpendInputRow = {
  date: string;
  source: string;
  spend: string;
  medium: string;
  campaign: string;
  currency: string;
  account: string;
  adGroup: string;
  externalId: string;
};

export type CustomSpendColumnKey = keyof CustomSpendInputRow;
export type CustomSpendCsvMapping = Record<CustomSpendColumnKey, number>;
export type ParsedCustomSpendCsv = {
  filename: string;
  headers: string[];
  rows: string[][];
  mapping: CustomSpendCsvMapping;
};

export const customSpendColumnFields: Array<{
  key: CustomSpendColumnKey;
  label: string;
  required: boolean;
  aliases: string[];
}> = [
  { key: "date", label: "Date", required: true, aliases: ["date", "spend_date", "day"] },
  { key: "source", label: "Source / channel", required: true, aliases: ["source", "channel", "platform"] },
  { key: "spend", label: "Spend", required: true, aliases: ["spend", "cost", "amount", "amount_spent"] },
  { key: "medium", label: "Medium", required: false, aliases: ["medium"] },
  { key: "campaign", label: "Campaign", required: false, aliases: ["campaign", "campaign_name"] },
  { key: "currency", label: "Currency", required: false, aliases: ["currency", "currency_code"] },
  { key: "account", label: "Account", required: false, aliases: ["account", "account_name"] },
  { key: "adGroup", label: "Ad group", required: false, aliases: ["ad_group", "adgroup", "ad_set", "adset"] },
  { key: "externalId", label: "External ID", required: false, aliases: ["external_id", "externalid", "id"] },
];

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function parseCustomSpendCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function parseCustomSpendCsv(text: string, filename: string): ParsedCustomSpendCsv {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("The CSV needs a header and at least one spend row");
  if (lines.length > 1001) throw new Error("Import up to 1,000 spend rows at a time");
  const headers = parseCustomSpendCsvLine(lines[0]).map((value) => value.trim());
  if (!headers.length || headers.some((header) => !header)) throw new Error("Every CSV column needs a header");
  const normalized = headers.map(normalizeHeader);
  const mapping = Object.fromEntries(customSpendColumnFields.map((field) => [
    field.key,
    field.aliases.map((alias) => normalized.indexOf(alias)).find((index) => index >= 0) ?? -1,
  ])) as CustomSpendCsvMapping;
  return {
    filename,
    headers,
    rows: lines.slice(1).map(parseCustomSpendCsvLine),
    mapping,
  };
}

export function buildCustomSpendRows(
  draft: ParsedCustomSpendCsv,
  mapping: CustomSpendCsvMapping,
  defaultCurrency: string,
): { ok: true; rows: CustomSpendInputRow[] } | { ok: false; error: string } {
  const missing = customSpendColumnFields.filter((field) => field.required && mapping[field.key] < 0);
  if (missing.length) return { ok: false, error: `Map the required ${missing.map((field) => field.label.toLowerCase()).join(", ")} columns` };
  const selected = customSpendColumnFields.map((field) => mapping[field.key]).filter((index) => index >= 0);
  if (new Set(selected).size !== selected.length) return { ok: false, error: "Each CSV column can only be mapped once" };
  const value = (cells: string[], key: CustomSpendColumnKey) => mapping[key] >= 0 ? cells[mapping[key]] ?? "" : "";
  return {
    ok: true,
    rows: draft.rows.map((cells) => ({
      date: value(cells, "date"),
      source: value(cells, "source"),
      spend: value(cells, "spend"),
      medium: value(cells, "medium"),
      campaign: value(cells, "campaign"),
      currency: value(cells, "currency") || defaultCurrency,
      account: value(cells, "account"),
      adGroup: value(cells, "adGroup"),
      externalId: value(cells, "externalId"),
    })),
  };
}
