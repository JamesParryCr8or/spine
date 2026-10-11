"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type Column<Row> = {
  key: string;
  header: string;
  /** Numbers and money: right-aligned with tabular figures. */
  numeric?: boolean;
  render?: (row: Row) => React.ReactNode;
  /** Makes the column sortable; also used for CSV when `csv` is not given. */
  sortValue?: (row: Row) => string | number | null;
  csv?: (row: Row) => string | number | null;
};

type DataTableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  loadingRows?: number;
  /** Shown instead of the table when there are no rows (use <EmptyState/>). */
  empty?: React.ReactNode;
  /** When set, shows an Export CSV button that downloads this file name. */
  exportName?: string;
  /** Scroll the body inside this height so the header stays visible. */
  maxHeight?: string;
  /** Names the table for screen readers. */
  caption: string;
  className?: string;
};

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const quote = (cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`;
  const blob = new Blob([`${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

/** A table with a sticky header, right-aligned numbers, click-to-sort columns and CSV export. */
export function DataTable<Row>({ columns, rows, rowKey, loading = false, loadingRows = 4, empty, exportName, maxHeight, caption, className }: DataTableProps<Row>) {
  const [sort, setSort] = React.useState<{ key: string; direction: 1 | -1 } | null>(null);

  const sorted = React.useMemo(() => {
    const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort((left, right) => {
      const a = value(left), b = value(right);
      if (a === null) return b === null ? 0 : 1; // blanks always last
      if (b === null) return -1;
      return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en-GB", { numeric: true })) * sort.direction;
    });
  }, [rows, columns, sort]);

  const exportCsv = () => {
    const exportable = columns.filter((column) => column.csv || column.sortValue);
    downloadCsv(exportName ?? "export.csv", [exportable.map((column) => column.header), ...sorted.map((row) => exportable.map((column) => (column.csv ?? column.sortValue)!(row) ?? ""))]);
  };

  if (!loading && rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={className}>
      {exportName && !loading && rows.length > 0 && (
        <div className="flex justify-end px-5 pb-3">
          <button type="button" onClick={exportCsv} className="inline-flex h-8 items-center gap-1.5 rounded-ds-sm border border-ds-line-strong bg-ds-surface px-3 text-ds-small font-semibold text-ds-ink hover:bg-ds-canvas"><Download className="size-3.5" aria-hidden="true" />Export CSV</button>
        </div>
      )}
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-collapse text-ds-small">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th key={column.key} scope="col" aria-sort={active ? (sort.direction === 1 ? "ascending" : "descending") : undefined}
                    className={cn("sticky top-0 z-10 whitespace-nowrap border-y border-ds-line bg-ds-canvas px-4 py-2.5 text-ds-label uppercase text-ds-muted", column.numeric ? "text-right" : "text-left")}>
                    {column.sortValue ? (
                      <button type="button" onClick={() => setSort((current) => ({ key: column.key, direction: current?.key === column.key ? (current.direction === 1 ? -1 : 1) : -1 }))}
                        className={cn("inline-flex items-center gap-1 uppercase hover:text-ds-ink", active && "text-ds-accent-strong", column.numeric && "flex-row-reverse")}>
                        {column.header}
                        {active ? (sort.direction === -1 ? <ArrowDown className="size-3" aria-hidden="true" /> : <ArrowUp className="size-3" aria-hidden="true" />) : null}
                      </button>
                    ) : column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRows }, (_, index) => <tr key={index}>{columns.map((column) => <td key={column.key} className="border-b border-ds-line px-4 py-3"><Skeleton style={{ width: column.numeric ? "50%" : "75%", height: 12, marginLeft: column.numeric ? "auto" : 0 }} /></td>)}</tr>)
              : sorted.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-ds-canvas/70">
                  {columns.map((column) => <td key={column.key} className={cn("border-b border-ds-line px-4 py-3 text-ds-ink", column.numeric && "text-right tabular-nums")}>{column.render ? column.render(row) : String(column.sortValue?.(row) ?? "")}</td>)}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
