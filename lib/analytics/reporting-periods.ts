export type ReportingGranularity = "daily" | "weekly" | "monthly" | "quarterly" | "annual";
export type ReportingPeriod = { start: string; end: string; label: string };

const date = (value: Date) => value.toISOString().slice(0, 10);
const parse = (value: string) => new Date(value + "T00:00:00.000Z");
const addDays = (value: Date, days: number) => { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; };

function nextBoundary(value: Date, granularity: ReportingGranularity) {
  if (granularity === "daily") return addDays(value, 1);
  if (granularity === "weekly") return addDays(value, 7);
  if (granularity === "monthly") return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  if (granularity === "quarterly") return new Date(Date.UTC(value.getUTCFullYear(), Math.floor(value.getUTCMonth() / 3) * 3 + 3, 1));
  return new Date(Date.UTC(value.getUTCFullYear() + 1, 0, 1));
}

function label(start: Date, end: Date, granularity: ReportingGranularity) {
  if (granularity === "daily") return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(start);
  if (granularity === "weekly") return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(start) + "–" + new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(end);
  if (granularity === "monthly") return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(start);
  if (granularity === "quarterly") return "Q" + (Math.floor(start.getUTCMonth() / 3) + 1) + " " + start.getUTCFullYear();
  return String(start.getUTCFullYear());
}

export function reportingPeriods(start: string, end: string, granularity: ReportingGranularity, limit = 24): ReportingPeriod[] {
  const rangeStart = parse(start);
  const rangeEnd = parse(end);
  if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeStart > rangeEnd) return [];
  const periods: ReportingPeriod[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const boundary = nextBoundary(cursor, granularity);
    const periodEnd = new Date(Math.min(addDays(boundary, -1).getTime(), rangeEnd.getTime()));
    periods.push({ start: date(cursor), end: date(periodEnd), label: label(cursor, periodEnd, granularity) });
    cursor = addDays(periodEnd, 1);
  }
  return periods.slice(-Math.max(limit, 1));
}
