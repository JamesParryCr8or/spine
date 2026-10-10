import { Info } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

type PanelStateProps =
  | { status: "loading"; message?: string; lines?: number }
  | { status: "error"; title: string; message?: string; onRetry?: () => void }
  | { status: "empty"; title: string; message?: string };

/**
 * The one loading / error / empty block for panels and tables. Loading shows
 * shimmer lines (never placeholder numbers) with a short caption; error keeps
 * the panel's frame and offers Retry; empty explains what will appear.
 */
export function PanelState(props: PanelStateProps) {
  if (props.status === "loading") {
    const lines = Math.max(1, props.lines ?? 3);
    return (
      <div className="panel-state loading" role="status" aria-live="polite">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} style={{ width: `${[92, 78, 64, 85, 70][index % 5]}%`, height: 10 }} />
        ))}
        <span className="panel-state-caption">{props.message ?? "Loading…"}</span>
      </div>
    );
  }
  if (props.status === "error") {
    return (
      <div className="panel-error" role="alert">
        <Info />
        <div>
          <strong>{props.title}</strong>
          <span>{props.message ?? "Check your connection and try again."}</span>
          {props.onRetry && <button type="button" onClick={props.onRetry}>Retry</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="panel-state empty">
      <Info />
      <div><strong>{props.title}</strong>{props.message && <span>{props.message}</span>}</div>
    </div>
  );
}

/** Small "Updating…" pill shown while cached numbers are on screen and fresh ones load. */
export function UpdatingChip({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="updating-chip" role="status" aria-live="polite"><span aria-hidden="true"/>Updating…</span>;
}
