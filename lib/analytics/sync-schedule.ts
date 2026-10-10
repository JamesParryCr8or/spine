export const defaultSyncHour = 6;

/** A refresh that finished this recently is fresh enough that opening the app doesn't start another. */
export const loginRefreshFreshMs = 4 * 60 * 60 * 1000;

export type SyncSchedule = { enabled: boolean; sync_hour: number } | null | undefined;

function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Whether the daily refresh is due for a store: its hour (store timezone) has
 * passed today and no scheduled run has started since local midnight. A store
 * with no schedule row uses the default (enabled, 06:00). Works with any
 * cron frequency: more ticks only mean it fires closer to the chosen hour.
 */
export function isDailySyncDue(input: { now: Date; timeZone: string; schedule: SyncSchedule; lastScheduledRunAt: string | null }) {
  const schedule = input.schedule ?? { enabled: true, sync_hour: defaultSyncHour };
  if (!schedule.enabled) return false;
  const now = localParts(input.now, input.timeZone || "UTC");
  if (now.hour < schedule.sync_hour) return false;
  if (!input.lastScheduledRunAt) return true;
  return localParts(new Date(input.lastScheduledRunAt), input.timeZone || "UTC").date !== now.date;
}
