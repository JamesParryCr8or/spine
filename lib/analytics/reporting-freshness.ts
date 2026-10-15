export type ReportingRun = {
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
  { source: "shopify_campaigns", provider: "shopify", label: "Campaigns" },
  { source: "shopify_orders", provider: "shopify", label: "Shopify orders" },
  { source: "meta", provider: "meta", label: "Meta" },
  { source: "google_ads", provider: "google_ads", label: "Google Ads" },
  { source: "bing_ads", provider: "bing_ads", label: "Microsoft Ads" },
  { source: "gohighlevel", provider: "gohighlevel", label: "GoHighLevel" },
];

/**
 * Per-source state of the background reporting refresh (reporting_sync_runs),
 * limited to connected sources. Newer direct imports supersede older background
 * results; a later background failure remains visible.
 */
export function reportingFreshness(connections: Array<{ provider: string; status: string }>, runs: ReportingRun[], sourceImports: Record<string, string | null> = {}) {
  const connected = new Set(connections.filter((connection) => connection.status === "connected").map((connection) => connection.provider));
  const finished = runs.filter((run) => run.status !== "running");
  return {
    running: runs[0]?.status === "running",
    lastRunAt: finished[0]?.completed_at ?? null,
    sources: reportingSources.filter((item) => connected.has(item.provider)).flatMap((item): Array<{ source: string; label: string; status: "ok" | "failed" | "pending"; lastRefreshedAt: string | null; message: string | null }> => {
      const latest = finished.find((run) => run.results?.some((candidate) => candidate.source === item.source));
      const importedAt = sourceImports[item.source] ?? null;
      const latestRunAt = latest?.completed_at ?? latest?.created_at ?? null;
      if (importedAt && (!latestRunAt || Date.parse(importedAt) > Date.parse(latestRunAt))) {
        return [{ source: item.source, label: item.label, status: "ok" as const, lastRefreshedAt: importedAt, message: null }];
      }
      // GoHighLevel only appears in results once a stage is configured.
      if (!latest) return item.source === "gohighlevel" ? [] : [{ source: item.source, label: item.label, status: "pending" as const, lastRefreshedAt: null, message: null }];
      const result = latest.results!.find((candidate) => candidate.source === item.source)!;
      const lastSuccess = finished.find((run) => run.results?.some((candidate) => candidate.source === item.source && candidate.status === "fulfilled"));
      return [{
        source: item.source,
        label: item.label,
        status: result.status === "fulfilled" ? "ok" as const : "failed" as const,
        lastRefreshedAt: [lastSuccess?.completed_at, importedAt].filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
        message: result.message ?? null,
      }];
    }),
  };
}

