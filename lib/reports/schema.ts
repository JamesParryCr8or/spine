export const REPORT_SCHEMA_VERSION = 1;

export const reportTypes = ["overview", "pnl", "sales", "products", "customers", "utm"] as const;
export const reportVisibilities = ["private", "organization"] as const;
export const reportDatePresets = ["all_imported", "latest_30_days", "latest_90_days"] as const;

export type ReportType = (typeof reportTypes)[number];
export type ReportVisibility = (typeof reportVisibilities)[number];
export type ReportDatePreset = (typeof reportDatePresets)[number];

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

type UtmReportFilters = { fromDate: string; toDate: string; source: string; medium: string; campaign: string; landingPage: string; customerType: string; country: string; product: string; comparisonMode: "previous_period" | "previous_year"; attributionModel: "first_touch" | "last_touch" };

type CreateReport = {
  name: string;
  description: string | null;
  reportType: ReportType;
  visibility: ReportVisibility;
  datePreset: ReportDatePreset;
  utmFilters?: UtmReportFilters;
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

function parseUtmFilters(value: unknown): UtmReportFilters | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const text = (key: string, maximum = 255) => typeof value[key] === "string" && value[key].trim().length <= maximum ? value[key].trim() : undefined;
  const fromDate = text("fromDate", 10), toDate = text("toDate", 10);
  const source = text("source"), medium = text("medium"), campaign = text("campaign"), landingPage = text("landingPage", 2048), customerType = text("customerType"), country = text("country"), product = text("product");
  const comparisonMode = value.comparisonMode ?? "previous_period";
  const attributionModel = value.attributionModel ?? "last_touch";
  if ([fromDate, toDate, source, medium, campaign, landingPage, customerType, country, product].some((item) => item === undefined)) return undefined;
  if ((fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) || (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate))) return undefined;
  if (comparisonMode !== "previous_period" && comparisonMode !== "previous_year") return undefined;
  if (attributionModel !== "first_touch" && attributionModel !== "last_touch") return undefined;
  return { fromDate: fromDate!, toDate: toDate!, source: source!, medium: medium!, campaign: campaign!, landingPage: landingPage!, customerType: customerType!, country: country!, product: product!, comparisonMode, attributionModel };
}

export function parseCreateReport(value: unknown): ValidationResult<CreateReport> {
  if (!isRecord(value)) return { ok: false, error: "Use a valid report definition" };
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = optionalText(value.description, 500);
  const visibility = value.visibility ?? "private";
  const datePreset = value.datePreset ?? "all_imported";
  const utmFilters = parseUtmFilters(value.utmFilters);
  if (!name || name.length > 120) return { ok: false, error: "Enter a report name of up to 120 characters" };
  if (description === undefined) return { ok: false, error: "Keep the report description under 500 characters" };
  if (!isMember(reportTypes, value.reportType) || !isMember(reportVisibilities, visibility) || !isMember(reportDatePresets, datePreset)) {
    return { ok: false, error: "Choose a valid report type, period, and sharing setting" };
  }
  if (utmFilters === undefined || (value.reportType !== "utm" && utmFilters !== null)) return { ok: false, error: "Use valid UTM report filters only with a UTM report" };
  return { ok: true, value: { name, description, reportType: value.reportType, visibility, datePreset, ...(utmFilters ? { utmFilters } : {}) } };
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


type FinishReportRun = {
  runId: string;
  status: "completed" | "failed";
  rowCount: number | null;
  errorMessage: string | null;
};

export function parseStartReportRun(value: unknown): ValidationResult<{ reportId: string }> {
  if (!isRecord(value) || typeof value.reportId !== "string" || !uuidPattern.test(value.reportId)) {
    return { ok: false, error: "A valid report id is required" };
  }
  return { ok: true, value: { reportId: value.reportId } };
}

export function parseFinishReportRun(value: unknown): ValidationResult<FinishReportRun> {
  if (!isRecord(value) || typeof value.runId !== "string" || !uuidPattern.test(value.runId)) {
    return { ok: false, error: "A valid report run id is required" };
  }
  if (value.status !== "completed" && value.status !== "failed") {
    return { ok: false, error: "Choose a valid report run status" };
  }
  let rowCount: number | null = null;
  if (value.rowCount !== undefined && value.rowCount !== null) {
    if (typeof value.rowCount !== "number" || !Number.isInteger(value.rowCount) || value.rowCount < 0) {
      return { ok: false, error: "Row count must be a non-negative whole number" };
    }
    rowCount = value.rowCount;
  }
  const errorMessage = optionalText(value.errorMessage, 500);
  if (errorMessage === undefined) return { ok: false, error: "Keep the run error under 500 characters" };
  return { ok: true, value: { runId: value.runId, status: value.status, rowCount, errorMessage } };
}
