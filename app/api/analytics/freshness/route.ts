import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

type ReportingRun = {
  status: "running" | "completed" | "failed";
  results: Array<{ source: string; status: "fulfilled" | "rejected"; message?: string }> | null;
  completed_at: string | null;
  created_at: string;
  error_message: string | null;
};

// Reporting sources, and the data_connections provider that has to be
// connected for each one to mean anything.
const reportingSources = [
  { source: "shopify", provider: "shopify", label: "Shopify sales" },
  { source: "shopify_payments", provider: "shopify", label: "Payment fees" },
  { source: "shopify_orders", provider: "shopify", label: "Shopify orders" },
  { source: "meta", provider: "meta", label: "Meta" },
  { source: "google_ads", provider: "google_ads", label: "Google Ads" },
  { source: "bing_ads", provider: "bing_ads", label: "Microsoft Ads" },
  { source: "gohighlevel", provider: "gohighlevel", label: "GoHighLevel" },
];

/**
 * Per-source state of the background reporting refresh (reporting_sync_runs),
 * limited to sources whose connection is set up. lastRefreshedAt is the newest
 * finished run in which that source succeeded.
 */
function reportingFreshness(connections: Array<{ provider: string; status: string }>, runs: ReportingRun[]) {
  const connected = new Set(connections.filter((connection) => connection.status === "connected").map((connection) => connection.provider));
  const finished = runs.filter((run) => run.status !== "running");
  return {
    running: runs[0]?.status === "running",
    lastRunAt: finished[0]?.completed_at ?? null,
    sources: reportingSources.filter((item) => connected.has(item.provider)).flatMap((item): Array<{ source: string; label: string; status: "ok" | "failed" | "pending"; lastRefreshedAt: string | null; message: string | null }> => {
      const latest = finished.find((run) => run.results?.some((candidate) => candidate.source === item.source));
      // GoHighLevel only appears in results once a stage is configured.
      if (!latest) return item.source === "gohighlevel" ? [] : [{ source: item.source, label: item.label, status: "pending" as const, lastRefreshedAt: null, message: null }];
      const result = latest.results!.find((candidate) => candidate.source === item.source)!;
      const lastSuccess = finished.find((run) => run.results?.some((candidate) => candidate.source === item.source && candidate.status === "fulfilled"));
      return [{
        source: item.source,
        label: item.label,
        status: result.status === "fulfilled" ? "ok" as const : "failed" as const,
        lastRefreshedAt: lastSuccess?.completed_at ?? null,
        message: result.message ?? null,
      }];
    }),
  };
}

export async function GET() {
  const result = await requireWorkspace();
  if (!result.ok) return result.response;
  const { supabase, store } = result;
  if (!store) {
    return NextResponse.json({
      connected: false,
      storeName: null,
      lastSuccessfulSync: null,
      latestStatus: null,
      recordsProcessed: 0,
      warnings: 0,
      reporting: null,
    });
  }

  const [connectionResult, successfulResult, latestResult, connectionsResult, reportingResult] = await Promise.all([
    supabase
      .from("data_connections")
      .select("status")
      .eq("store_id", store.id)
      .eq("provider", "shopify")
      .maybeSingle(),
    supabase
      .from("sync_runs")
      .select("completed_at,records_processed,warnings")
      .eq("store_id", store.id)
      .eq("source", "shopify")
      .eq("status", "completed")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sync_runs")
      .select("status,updated_at,error_message")
      .eq("store_id", store.id)
      .eq("source", "shopify")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("data_connections")
      .select("provider,status")
      .eq("store_id", store.id),
    supabase
      .from("reporting_sync_runs")
      .select("status,results,completed_at,created_at,error_message")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const error = connectionResult.error ?? successfulResult.error ?? latestResult.error ?? connectionsResult.error ?? reportingResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const completed = successfulResult.data;
  const latest = latestResult.data;
  const interrupted =
    latest?.status === "running" &&
    Date.parse(latest.updated_at) < Date.now() - 6 * 60 * 1000;
  return NextResponse.json({
    reporting: reportingFreshness(connectionsResult.data ?? [], (reportingResult.data ?? []) as ReportingRun[]),
    connected: connectionResult.data?.status === "connected",
    storeName: store.name ?? null,
    lastSuccessfulSync: completed?.completed_at ?? null,
    recordsProcessed: completed?.records_processed ?? 0,
    warnings: Array.isArray(completed?.warnings) ? completed.warnings.length : 0,
    latestStatus: interrupted ? "interrupted" : latest?.status ?? null,
    latestError: interrupted
      ? "The historical import paused at its saved checkpoint. Reconnect Shopify to resume it."
      : latest?.error_message ?? null,
  });
}
