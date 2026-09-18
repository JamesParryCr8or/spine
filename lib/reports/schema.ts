export const REPORT_SCHEMA_VERSION = 1;

export const reportTypes = ["overview", "pnl", "sales", "products", "customers", "utm"] as const;
export const reportVisibilities = ["private", "organization"] as const;
export const reportDatePresets = ["all_imported", "latest_30_days", "latest_90_days"] as const;

export type ReportType = (typeof reportTypes)[number];
export type ReportVisibility = (typeof reportVisibilities)[number];
export type ReportDatePreset = (typeof reportDatePresets)[number];

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

type CreateReport = {
  name: string;
  description: string | null;
  reportType: ReportType;
  visibility: ReportVisibility;
  datePreset: ReportDatePreset;
};

type UpdateReport =
  | { id: string; action: "duplicate" | "archive" | "restore" }
  | { id: string; action: "favorite"; isFavorite: boolean }
  | { id: string; action: "rename"; name: string; description: string | null; visibility?: ReportVisibility };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isMember = <T extends readonly string[]>(values: T, value: unknown): value is T[number] => typeof value === "string" && values.includes(value);
const optionalText = (value: unknown, maximum: number) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized || null : undefined;
};

export function parseCreateReport(value: unknown): ValidationResult<CreateReport> {
  if (!isRecord(value)) return { ok: false, error: "Use a valid report definition" };
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = optionalText(value.description, 500);
  const visibility = value.visibility ?? "private";
  const datePreset = value.datePreset ?? "all_imported";
  if (!name || name.length > 120) return { ok: false, error: "Enter a report name of up to 120 characters" };
  if (description === undefined) return { ok: false, error: "Keep the report description under 500 characters" };
  if (!isMember(reportTypes, value.reportType) || !isMember(reportVisibilities, visibility) || !isMember(reportDatePresets, datePreset)) {
    return { ok: false, error: "Choose a valid report type, period, and sharing setting" };
  }
  return { ok: true, value: { name, description, reportType: value.reportType, visibility, datePreset } };
}

export function parseUpdateReport(value: unknown): ValidationResult<UpdateReport> {
  if (!isRecord(value) || typeof value.id !== "string" || !uuidPattern.test(value.id)) {
    return { ok: false, error: "A valid report id is required" };
  }
  if (value.action === "duplicate" || value.action === "archive" || value.action === "restore") {
    return { ok: true, value: { id: value.id, action: value.action } };
  }
  if (value.action === "rename") {
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const description = optionalText(value.description, 500);
    if (!name || name.length > 120) return { ok: false, error: "Enter a report name of up to 120 characters" };
    if (description === undefined) return { ok: false, error: "Keep the report description under 500 characters" };
    if (value.visibility !== undefined && !isMember(reportVisibilities, value.visibility)) {
      return { ok: false, error: "Choose a valid sharing setting" };
    }
    return { ok: true, value: { id: value.id, action: "rename", name, description, ...(value.visibility ? { visibility: value.visibility } : {}) } };
  }
  if (typeof value.isFavorite === "boolean" && value.action === undefined) {
    return { ok: true, value: { id: value.id, action: "favorite", isFavorite: value.isFavorite } };
  }
  return { ok: false, error: "Choose a valid report update" };
}
