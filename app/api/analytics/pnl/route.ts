import { loadReportingPnlInputs as loadPnlInputs } from "@/lib/analytics/reporting-inputs";
import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { computePnl } from "@/lib/analytics/pnl-engine";
import { timed } from "@/lib/server-timing";

export const maxDuration = 300;

/** One P&L for one date range. Multi-period views use ./series instead. */
async function handleGet(request: Request) {
  const params = new URL(request.url).searchParams;
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if ((fromDate && !isDate(fromDate)) || (toDate && !isDate(toDate)) || (fromDate && toDate && fromDate > toDate)) {
    return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });
  }
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const loaded = await loadPnlInputs(supabase, store, { from: fromDate || null, to: toDate || null });
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });
  return NextResponse.json(computePnl(loaded.inputs, store));
}

export const GET = timed("analytics/pnl", handleGet);
