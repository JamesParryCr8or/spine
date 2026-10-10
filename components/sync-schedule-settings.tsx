"use client";

import { useEffect, useState } from "react";

import { PanelState } from "@/components/ui/panel-state";

type ScheduleState = { enabled: boolean; syncHour: number; timezone: string; canManage: boolean };

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Per-store daily data refresh time (store timezone). Owners/admins can change it. */
export function SyncScheduleSettings() {
  const [state, setState] = useState<ScheduleState | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [hour, setHour] = useState(6);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/sync-schedule", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load the refresh schedule");
        const value = payload as ScheduleState;
        setState(value); setEnabled(value.enabled); setHour(value.syncHour);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the refresh schedule"); });
    return () => controller.abort();
  }, []);

  if (!state) return <section className="panel report-panel">{error ? <PanelState status="error" title="Refresh schedule could not be loaded" message={error}/> : <PanelState status="loading" lines={2} message="Loading refresh schedule…"/>}</section>;

  const dirty = enabled !== state.enabled || hour !== state.syncHour;
  const save = async () => {
    setSaving(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/settings/sync-schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, syncHour: hour }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save the refresh schedule");
      const value = payload as ScheduleState;
      setState(value); setStatus("Saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the refresh schedule");
    } finally {
      setSaving(false);
    }
  };

  return <section className="panel report-panel">
    <div className="panel-head"><div>
      <span className="eyebrow">DATA REFRESH</span>
      <h2>Daily refresh</h2>
      <p>Spine refreshes this brand&apos;s Shopify, ad and lead data once a day, and again when someone opens the app if it&apos;s been a few hours. Times use the brand&apos;s timezone ({state.timezone}).</p>
    </div></div>
    <div className="filter-row">
      <label>Daily refresh<select value={enabled ? "on" : "off"} disabled={!state.canManage} onChange={(event) => { setEnabled(event.target.value === "on"); setStatus(""); }}><option value="on">On</option><option value="off">Off</option></select></label>
      <label>Refresh at<select value={hour} disabled={!state.canManage || !enabled} onChange={(event) => { setHour(Number(event.target.value)); setStatus(""); }}>{Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{hourLabel(value)}</option>)}</select></label>
      {state.canManage && <button className="primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save schedule"}</button>}
      {status && <span className="report-note" role="status">{status}</span>}
    </div>
    {error && <div className="panel-error" role="alert">{error}</div>}
  </section>;
}
