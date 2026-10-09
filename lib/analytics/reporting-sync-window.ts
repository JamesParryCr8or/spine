/** A rolling window ending today, wide enough to catch late refunds, cancellations and attribution revisions. */
export function rollingSyncWindow(days = 4) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { from: date(from), to: date(to) };
}
