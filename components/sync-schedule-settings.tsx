"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormField, FormGrid, SelectInput } from "@/components/ui/form-field";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { useToast } from "@/components/ui/toast";

type ScheduleState = { enabled: boolean; syncHour: number; timezone: string; canManage: boolean };

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Per-store daily data refresh time (store timezone). Owners/admins can change it. */
export function SyncScheduleSettings() {
  const { toast } = useToast();
  const [state, setState] = useState<ScheduleState | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [hour, setHour] = useState(6);
  const [saving, setSaving] = useState(false);
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

  if (!state) return <Panel>{error ? <PanelState status="error" title="Refresh schedule could not be loaded" message={error}/> : <PanelState status="loading" lines={2} message="Loading refresh schedule…"/>}</Panel>;

  const dirty = enabled !== state.enabled || hour !== state.syncHour;
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/sync-schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, syncHour: hour }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save the refresh schedule");
      setState(payload as ScheduleState);
      toast({ title: "Refresh schedule saved", tone: "success" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the refresh schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel eyebrow="Data refresh" title="Daily refresh" description={<>Spine refreshes this brand&apos;s Shopify, ad and lead data once a day, and again when someone opens the app if it&apos;s been a few hours. Times use the brand&apos;s timezone ({state.timezone}).</>}>
      <FormGrid>
        <FormField label="Daily refresh"><SelectInput value={enabled ? "on" : "off"} disabled={!state.canManage} onChange={(event) => setEnabled(event.target.value === "on")}><option value="on">On</option><option value="off">Off</option></SelectInput></FormField>
        <FormField label="Refresh at"><SelectInput value={hour} disabled={!state.canManage || !enabled} onChange={(event) => setHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{hourLabel(value)}</option>)}</SelectInput></FormField>
      </FormGrid>
      {error && <div className="mt-4"><PanelState status="error" title="That did not work" message={error}/></div>}
      {state.canManage && <div className="mt-4 flex justify-end"><Button variant="primary" size="md" loading={saving} disabled={!dirty} onClick={() => void save()}>Save schedule</Button></div>}
    </Panel>
  );
}
