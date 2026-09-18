const dayMs = 24 * 60 * 60 * 1000;

type ExistingWindow = { sync_mode?: "initial" | "incremental" | null; window_start?: string | null; window_end?: string | null } | null;

export function shopifySyncWindow({ existingRun, latestCompletedAt, now = new Date(), overlapDays = 7 }: { existingRun: ExistingWindow; latestCompletedAt: string | null; now?: Date; overlapDays?: number }) {
  const end = existingRun?.window_end ?? now.toISOString();
  const start = existingRun?.window_start ?? (latestCompletedAt ? new Date(Date.parse(latestCompletedAt) - overlapDays * dayMs).toISOString() : null);
  return { mode: existingRun?.sync_mode ?? (start ? "incremental" : "initial"), start, end } as const;
}

export function shopifyUpdatedAtQuery(start: string | null, end: string) {
  return start ? `updated_at:>=${start} updated_at:<${end}` : `updated_at:<${end}`;
}
