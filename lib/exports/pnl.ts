import type { ColumnStyle, XlsxOptions } from "./xlsx";

export type PnlExportGroup = {
  heading: string;
  rows: Array<{ label: string; format: ColumnStyle; values: Array<number | string | null> }>;
};

export function formatPnlValue(value: number | string | null, format: ColumnStyle, currency: string) {
  if (value === null || (typeof value === "number" && !Number.isFinite(value))) return "—";
  if (typeof value === "string") return value;
  if (format === "percentage") return `${(value * 100).toFixed(1)}%`;
  if (format === "multiple") return `${value.toFixed(2)}x`;
  if (format === "decimal") return value.toFixed(1);
  return new Intl.NumberFormat("en-GB", format === "currency"
    ? { style: "currency", currency, maximumFractionDigits: 0 }
    : { maximumFractionDigits: 0 }).format(value);
}

// Values come from the same row definitions as the report. Never parse rounded
// display strings or sum ratios/customer counts to manufacture a period total.
export function buildPnlExport(input: {
  metadata: string[][];
  columns: string[];
  groups: PnlExportGroup[];
  currency: string;
}) {
  const rows: Array<Array<string | number>> = [...input.metadata, [], ["Metric", ...input.columns]];
  const headerRow = rows.length - 1;
  const csvRows: Array<Array<string | number>> = rows.map((row) => [...row]);
  const rowStyles: Record<number, ColumnStyle> = {};
  const headingRows: number[] = [];
  for (const group of input.groups) {
    headingRows.push(rows.length);
    const heading = [group.heading, ...input.columns.map(() => "")];
    rows.push(heading);
    csvRows.push(heading);
    for (const row of group.rows) {
      rowStyles[rows.length] = row.format;
      const values = row.values.map((value) => value === null || (typeof value === "number" && !Number.isFinite(value)) ? "—" : value);
      rows.push([row.label, ...values]);
      csvRows.push([row.label, ...values.map((value) => formatPnlValue(value, row.format, input.currency))]);
    }
  }
  const options: XlsxOptions = {
    sheetName: "Profit and Loss", headerRow, headingRows, rowStyles,
    currency: input.currency, columnWidths: [42, ...input.columns.map(() => 23)], autoFilter: false,
  };
  return { rows, csvRows, options };
}
