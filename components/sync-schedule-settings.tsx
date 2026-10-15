import { Panel } from "@/components/ui/panel";

export function SyncScheduleSettings() {
  return <Panel eyebrow="Data refresh" title="Automatic refresh" description="Spine refreshes this store when you open or return to the app, at most once every two hours. It also checks every two hours while the app is visible.">
    <p className="text-ds-small text-ds-muted">Enabled email and webhook reports refresh their data before sending. When nobody is using the app and no report is due, the store does not sync in the background. Use Sync now whenever you need an immediate refresh.</p>
  </Panel>;
}
