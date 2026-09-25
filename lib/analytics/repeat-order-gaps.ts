export type RepeatOrderGapBucket = {
  label: string;
  start: number;
  end: number;
  count: number;
  share: number;
  cumulativeShare: number;
};

const ranges = [
  [0, 14],
  [15, 29],
  [30, 59],
  [60, 89],
  [90, 119],
  [120, 179],
  [180, 239],
  [240, 299],
  [300, 365],
  [366, Infinity],
] as const;

export function bucketRepeatOrderGaps(gaps: number[]): RepeatOrderGapBucket[] {
  const valid = gaps.filter((gap) => Number.isFinite(gap) && gap >= 0);
  const counts = ranges.map(() => 0);
  for (const gap of valid) {
    // Order timestamps include hours. Bucket by complete elapsed days so
    // fractional values cannot fall between adjacent integer-day ranges.
    const days = Math.floor(gap);
    const index = ranges.findIndex(([start, end]) => days >= start && days <= end);
    if (index >= 0) counts[index] += 1;
  }
  let cumulative = 0;
  return ranges.map(([start, end], index) => {
    const count = counts[index];
    cumulative += count;
    return {
      label: Number.isFinite(end) ? `${start}–${end} days` : `${start}+ days`,
      start,
      end,
      count,
      share: valid.length ? count / valid.length : 0,
      cumulativeShare: valid.length ? cumulative / valid.length : 0,
    };
  });
}
