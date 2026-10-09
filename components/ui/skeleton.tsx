import { type CSSProperties } from "react";

/** A single shimmering placeholder block. Compose these into layout-specific skeletons. */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

/** Matches the shape of a `.metric-card` KPI tile while its data is loading. */
export function StatCardSkeleton() {
  return (
    <div className="metric-card skeleton-card" aria-hidden="true">
      <div className="metric-head"><Skeleton style={{ width: "55%", height: 10 }} /></div>
      <Skeleton style={{ width: "72%", height: 22, marginTop: 10 }} />
      <Skeleton style={{ width: "40%", height: 9, marginTop: 10 }} />
    </div>
  );
}

/** A row of shimmering cells for a `<table className="data-table">` body while it loads. */
export function TableRowSkeleton({ columns = 2 }: { columns?: number }) {
  return (
    <tr className="skeleton-row" aria-hidden="true">
      {Array.from({ length: columns }, (_, index) => (
        <td key={index}><Skeleton style={{ width: index === 0 ? "70%" : "48%", height: 11 }} /></td>
      ))}
    </tr>
  );
}
