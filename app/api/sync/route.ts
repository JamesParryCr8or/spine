import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";
import { createReportingClient } from "@/lib/analytics/reporting-refresh";
import { rollingSyncWindow, runReportingSyncForStore } from "@/lib/analytics/reporting-sync";

export const maxDuration = 90;

/**
 * Manual "Sync now" action. The scheduled cron job (app/api/cron/sync)
 * keeps reporting data within about an hour of fresh on its own; this lets
 * a signed-in user pull a fresher refresh on demand - e.g. right after
 * connecting Shopify - without waiting for the next cron tick. Runs
 * synchronously (unlike the cron job) so the response reflects what
 * actually happened, for a UI that shows the result immediately.
 */
export async function POST() {
  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const { from, to } = rollingSyncWindow();
  const outcome = await runReportingSyncForStore(createReportingClient(), store, from, to, "manual");
  if (outcome.status === "failed") return NextResponse.json({ error: outcome.error }, { status: 500 });
  return NextResponse.json({ window: { from, to }, outcome });
}
