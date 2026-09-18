const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function zonedMidnight(date: string, timeZone: string) {
  if (!datePattern.test(date)) throw new Error("Use a valid calendar date");
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day);
  let timestamp = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = dateParts(new Date(timestamp), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = desired - represented;
    timestamp += correction;
    if (correction === 0) break;
  }
  return new Date(timestamp);
}

function nextCalendarDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

/** Converts inclusive store-local dates into an exact UTC half-open range. */
export function reportingRangeToUtc(from: string, to: string, timeZone: string) {
  const start = zonedMidnight(from, timeZone);
  const endExclusive = zonedMidnight(nextCalendarDate(to), timeZone);
  return { start: start.toISOString(), endExclusive: endExclusive.toISOString() };
}


/** Returns the store-local calendar date for a UTC source timestamp. */
export function reportingDateKey(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error("Use a valid timestamp");
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Returns the store-local calendar month for a UTC source timestamp. */
export function reportingMonthKey(value: string | Date, timeZone: string) {
  return reportingDateKey(value, timeZone).slice(0, 7);
}
