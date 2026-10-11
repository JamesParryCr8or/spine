"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormField, FormGrid, SelectInput, TextInput } from "@/components/ui/form-field";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { useToast } from "@/components/ui/toast";

type WeeklyReportState = { enabled: boolean; webhookUrl: string | null; globalWebhookConfigured: boolean; canManage: boolean };

/**
 * Per-store opt-in for the Monday weekly report (app/api/cron/weekly-overview-report).
 * Owners and admins only; other roles don't see the panel.
 */
export function WeeklyReportSettings() {
  const { toast } = useToast();
  const [state, setState] = useState<WeeklyReportState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
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

  if (!state?.canManage) return error ? <Panel><PanelState status="error" title="Weekly report settings could not be loaded" message={error}/></Panel> : null;

  const dirty = enabled !== state.enabled || webhookUrl.trim() !== (state.webhookUrl ?? "");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/weekly-report", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, webhookUrl }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save weekly report settings");
      const value = payload as WeeklyReportState;
      setState(value);
      setWebhookUrl(value.webhookUrl ?? "");
      toast({ title: "Weekly report settings saved", tone: "success" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save weekly report settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel eyebrow="Weekly report" title="Monday summary" description="Send last week's sales, profit and ad spend for this brand to a webhook (for example a GoHighLevel workflow) every Monday. Off until you turn it on.">
      <FormGrid>
        <FormField label="Send weekly report"><SelectInput value={enabled ? "on" : "off"} onChange={(event) => setEnabled(event.target.value === "on")}><option value="off">Off</option><option value="on">On</option></SelectInput></FormField>
        <FormField label="Webhook URL" optional={state.globalWebhookConfigured} hint={state.globalWebhookConfigured ? "Leave blank to use the default webhook." : undefined}><TextInput type="url" placeholder="https://…" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)}/></FormField>
      </FormGrid>
      {error && <div className="mt-4"><PanelState status="error" title="That did not work" message={error}/></div>}
      <div className="mt-4 flex justify-end"><Button variant="primary" size="md" loading={saving} disabled={!dirty} onClick={() => void save()}>Save weekly report</Button></div>
    </Panel>
  );
}
