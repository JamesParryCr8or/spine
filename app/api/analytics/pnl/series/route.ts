import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { computePnl, contiguousSpans, loadPnlInputs, slicePnlInputs, type PnlInputs } from "@/lib/analytics/pnl-engine";

export const maxDuration = 60;

const maxPeriods = 400;
// A P&L screen asks for its columns plus a previous-year comparison: two
// spans. More than a handful means the caller is asking for unrelated ranges.
const maxSpans = 4;

/**
 * Many P&L periods in one request:
 *   GET /api/analytics/pnl/series?periods=2026-01-01_2026-01-31,2026-02-01_2026-02-28
 * Adjacent periods share one load of the underlying rows, so twelve monthly
 * columns cost one set of queries instead of twelve.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("periods") ?? "";
  const periods = raw.split(",").filter(Boolean).map((value) => {
    const [start, end] = value.split("_");
    return { start, end };
  });
  const isDate = (value: string | undefined) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!periods.length || periods.length > maxPeriods || periods.some((period) => !isDate(period.start) || !isDate(period.end) || period.start > period.end)) {
    return NextResponse.json({ error: `Pass 1-${maxPeriods} periods as start_end dates` }, { status: 400 });
  }
  const spans = contiguousSpans(periods);
  if (spans.length > maxSpans) {
    return NextResponse.json({ error: `Periods must fall in at most ${maxSpans} continuous date ranges` }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const loaded = await Promise.all(spans.map((span) => loadPnlInputs(supabase, store, span)));
  const failed = loaded.find((result) => !result.ok);
  if (failed && !failed.ok) return NextResponse.json({ error: failed.error }, { status: 500 });
  const spanInputs = loaded.map((result) => (result as { ok: true; inputs: PnlInputs }).inputs);

  return NextResponse.json({
    periods: periods.map((period) => {
      const inputs = spanInputs.find((candidate) => candidate.range.from! <= period.start && candidate.range.to! >= period.end)!;
      return { start: period.start, end: period.end, data: computePnl(slicePnlInputs(inputs, store, { from: period.start, to: period.end }), store) };
    }),
  });
}
