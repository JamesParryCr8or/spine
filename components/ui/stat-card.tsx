import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  /** Small line under the value. */
  hint?: React.ReactNode;
  /** Change against a comparison period, as a fraction (0.12 = +12%). */
  delta?: number | null;
  /** Whether a rise is good (revenue) or bad (costs, refunds). Sets the delta colour. */
  goodWhen?: "up" | "down";
  /** Recent values for a small trend line. */
  trend?: number[];
  /** Extra explanation, shown on hover and to screen readers. */
  info?: string;
  loading?: boolean;
  className?: string;
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / span) * 24 - 2}`).join(" ");
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" className="h-7 w-full"><polyline points={points} fill="none" stroke="var(--ds-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

/** A KPI tile. While loading it shows a shimmer, never a placeholder number. */
export function StatCard({ label, value, hint, delta, goodWhen = "up", trend, info, loading = false, className }: StatCardProps) {
  const good = delta === null || delta === undefined ? null : goodWhen === "up" ? delta >= 0 : delta <= 0;
  return (
    <article className={cn("rounded-ds border border-ds-line bg-ds-surface p-4 shadow-ds", className)} title={info}>
      <span className="block text-ds-label uppercase text-ds-muted">{label}</span>
      {loading ? (
        <Skeleton style={{ width: "55%", height: 28, marginTop: 10 }} />
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <strong className="text-ds-display tabular-nums text-ds-ink">{value}</strong>
            {good !== null && delta !== null && delta !== undefined && (
              <span className={cn("rounded-full px-2 py-0.5 text-ds-small font-semibold tabular-nums", good ? "bg-ds-positive-soft text-ds-positive" : "bg-ds-negative-soft text-ds-negative")}>
                {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
              </span>
            )}
          </div>
          {hint && <span className="mt-1 block text-ds-small text-ds-muted">{hint}</span>}
          {trend && <div className="mt-2"><Sparkline values={trend} /></div>}
          {info && <span className="sr-only">{info}</span>}
        </>
      )}
    </article>
  );
}
