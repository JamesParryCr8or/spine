"use client";

import { useEffect, useState } from "react";

type WeeklyReportState = { enabled: boolean; webhookUrl: string | null; globalWebhookConfigured: boolean; canManage: boolean };

/**
 * Per-store opt-in for the Monday weekly report (app/api/cron/weekly-overview-report).
 * Owners and admins only; other roles don't see the panel.
 */
export function WeeklyReportSettings() {
  const [state, setState] = useState<WeeklyReportState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/weekly-report", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load weekly report settings");
        const value = payload as WeeklyReportState;
        setState(value);
        setEnabled(value.enabled);
        setWebhookUrl(value.webhookUrl ?? "");
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load weekly report settings"); });
    return () => controller.abort();
  }, []);

  if (!state?.canManage) return error ? <section className="panel report-panel"><div className="panel-error" role="alert">{error}</div></section> : null;

  const dirty = enabled !== state.enabled || webhookUrl.trim() !== (state.webhookUrl ?? "");
  const save = async () => {
    setSaving(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/settings/weekly-report", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, webhookUrl }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save weekly report settings");
      const value = payload as WeeklyReportState;
      setState(value);
      setWebhookUrl(value.webhookUrl ?? "");
      setStatus("Saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save weekly report settings");
    } finally {
      setSaving(false);
    }
  };

  return <section className="panel report-panel">
    <div className="panel-head"><div>
      <span className="eyebrow">WEEKLY REPORT</span>
      <h2>Monday summary</h2>
      <p>Send last week&apos;s sales, profit and ad spend for this brand to a webhook (for example a GoHighLevel workflow) every Monday. Off until you turn it on.</p>
    </div></div>
    <div className="filter-row">
      <label>Send weekly report<select value={enabled ? "on" : "off"} onChange={(event) => { setEnabled(event.target.value === "on"); setStatus(""); }}><option value="off">Off</option><option value="on">On</option></select></label>
      <label>Webhook URL<input type="url" placeholder={state.globalWebhookConfigured ? "Leave blank to use the default webhook" : "https://…"} value={webhookUrl} onChange={(event) => { setWebhookUrl(event.target.value); setStatus(""); }}/></label>
      <button className="primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save weekly report"}</button>
      {status && <span className="report-note" role="status">{status}</span>}
    </div>
    {error && <div className="panel-error" role="alert">{error}</div>}
  </section>;
}
