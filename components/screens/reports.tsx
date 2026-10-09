"use client";

import { useCallback, useEffect, useState } from "react";
import { starterReports } from "@/lib/reports/starter-templates";
import { Plus, RefreshCw, Table2, X, Trash2 } from "lucide-react";
import { type View, type DrilldownContext } from "@/components/analytics/shared";
import { PanelState } from "@/components/ui/panel-state";

type SavedReport = { id: string; name: string; description: string | null; report_type: "overview" | "pnl" | "sales" | "products" | "customers" | "utm"; visibility: "private" | "organization"; is_favorite: boolean; configuration: { schemaVersion?: number; datePreset?: "all_imported" | "latest_30_days" | "latest_90_days"; utmFilters?: DrilldownContext }; definition_version: number; last_successful_run_at: string | null; updated_at: string };

type SavedReportRun = { id: string; report_id: string; definition_version: number; status: "running" | "completed" | "failed"; row_count: number | null; error_message: string | null; started_at: string; completed_at: string | null };

const reportViews: Record<SavedReport["report_type"], View> = { overview: "Overview", pnl: "Profit & Loss", sales: "Sales", products: "Products", customers: "Customers", utm: "UTM Analysis" };

const reportTypeLabels: Record<SavedReport["report_type"], string> = { overview: "Overview", pnl: "Profit & Loss", sales: "Sales orders", products: "Product profitability", customers: "Customers", utm: "UTM analysis" };

const datePresetLabels = { all_imported: "All imported data", latest_30_days: "Latest 30 days", latest_90_days: "Latest 90 days" } as const;

export function Reports({ openReport }: { openReport: (view: View, preset: "all_imported" | "latest_30_days" | "latest_90_days", runId: string, filters?: DrilldownContext) => void }) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", description: "", reportType: "pnl", visibility: "private", datePreset: "all_imported" });
  const [editing, setEditing] = useState<SavedReport | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", visibility: "private" });
  const [runHistoryReport, setRunHistoryReport] = useState<SavedReport | null>(null);
  const [runHistory, setRunHistory] = useState<SavedReportRun[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const load = useCallback(() => fetch(`/api/reports${showArchived ? "?archived=true" : ""}`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load reports"); setReports(payload.reports ?? []); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load reports")).finally(() => setLoading(false)), [showArchived]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save report");
      setShowSave(false); setForm({ name: "", description: "", reportType: "pnl", visibility: "private", datePreset: "all_imported" }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save report"); } finally { setSaving(false); }
  };
  const updateReport = async (payload: Record<string, unknown>, fallback: string) => {
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) { const responsePayload = await response.json(); throw new Error(responsePayload.error || fallback); }
      await load();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : fallback); return false; }
  };
  const toggleFavorite = (report: SavedReport) => updateReport({ id: report.id, isFavorite: !report.is_favorite }, "Could not update favourite");
  const duplicate = (report: SavedReport) => updateReport({ id: report.id, action: "duplicate" }, "Could not duplicate report");
  const archive = (report: SavedReport) => updateReport({ id: report.id, action: "archive" }, "Could not archive report");
  const restore = (report: SavedReport) => updateReport({ id: report.id, action: "restore" }, "Could not restore report");
  const beginRename = (report: SavedReport) => { setEditing(report); setEditForm({ name: report.name, description: report.description || "", visibility: report.visibility }); };
  const rename = async () => {
    if (!editing) return;
    const updated = await updateReport({ id: editing.id, action: "rename", name: editForm.name, description: editForm.description, visibility: editForm.visibility }, "Could not update report");
    if (updated) setEditing(null);
  };
  const runReport = async (report: SavedReport) => {
    setError("");
    const response = await fetch("/api/reports/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId: report.id }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error || "Could not start report"); return; }
    openReport(reportViews[report.report_type], report.configuration?.datePreset ?? "all_imported", payload.run.id, report.configuration?.utmFilters);
  };
  const showRunHistory = async (report: SavedReport) => {
    setRunHistoryReport(report); setRunHistory([]); setRunHistoryLoading(true); setError("");
    try {
      const response = await fetch(`/api/reports/runs?reportId=${encodeURIComponent(report.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load run history");
      setRunHistory(payload.runs ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load run history");
      setRunHistoryReport(null);
    } finally {
      setRunHistoryLoading(false);
    }
  };
  return <><section className="cost-toolbar"><div><span className="eyebrow">REPORT LIBRARY</span><h2>Saved reports</h2><p>Keep the report views you revisit, then share them with your workspace when ready.</p></div><div className="feature-actions"><button onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Current reports" : "Archived reports"}</button>{!showArchived && <button className="primary" onClick={() => setShowSave(true)}><Plus/> Save report</button>}</div></section><section className="panel report-panel starter-reports"><div className="panel-head"><div><span className="eyebrow">STARTER TEMPLATES</span><h2>Begin with a trusted view</h2></div></div><div className="template-grid">{starterReports.map((template) => <button key={template.name} onClick={() => { setForm({ name: template.name, description: template.description, reportType: template.reportType, visibility: "private", datePreset: template.datePreset }); setShowSave(true); }}><strong>{template.name}</strong><span>{template.description}</span></button>)}</div></section>{error && <div className="connection-error cost-error">{error}</div>}<section className="panel report-panel">{loading ? <PanelState status="loading" message="Loading saved reports…"/> : reports.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Report</th><th>Version</th><th>Type</th><th>Access</th><th>Period</th><th>Last successful run</th><th>Updated</th><th/></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.name}</strong>{report.description && <small>{report.description}</small>}</td><td>v{report.definition_version}</td><td>{reportTypeLabels[report.report_type]}</td><td>{report.visibility === "organization" ? "Workspace shared" : "Private"}</td><td>{datePresetLabels[report.configuration?.datePreset ?? "all_imported"]}</td><td>{report.last_successful_run_at ? new Date(report.last_successful_run_at).toLocaleString("en-GB") : "Not run yet"}</td><td>{new Date(report.updated_at).toLocaleDateString("en-GB")}</td><td><div className="feature-actions"><button className={report.is_favorite ? "favourite-report active" : "favourite-report"} title={report.is_favorite ? "Remove favourite" : "Add favourite"} onClick={() => void toggleFavorite(report)}>{report.is_favorite ? "★" : "☆"}</button><button onClick={() => void runReport(report)}>Open</button><button onClick={() => void showRunHistory(report)}>History</button><button onClick={() => beginRename(report)}>Rename</button><button onClick={() => void duplicate(report)}>Duplicate</button>{showArchived ? <button onClick={() => void restore(report)}>Restore</button> : <button className="icon-button" title="Archive report" onClick={() => void archive(report)}><Trash2/></button>}</div></td></tr>)}</tbody></table></div> : <div className="cost-empty"><Table2/><strong>No saved reports yet</strong><span>Save a report configuration to keep it in your library.</span></div>}</section>{showSave && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowSave(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><Table2/></span><div><span className="eyebrow">REPORT LIBRARY</span><h2>Save report</h2></div></div><label className="form-field"><span>Report name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Weekly P&L"/></label><label className="form-field"><span>Report type</span><select value={form.reportType} onChange={(event) => setForm({ ...form, reportType: event.target.value })}>{Object.entries(reportTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>Access</span><select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}><option value="private">Private to me</option><option value="organization">Share with workspace</option></select></label><label className="form-field"><span>Date range</span><select value={form.datePreset} onChange={(event) => setForm({ ...form, datePreset: event.target.value })}>{Object.entries(datePresetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>Description <small>Optional</small></span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What this view is for"/></label><div className="modal-actions"><button onClick={() => setShowSave(false)}>Cancel</button><button className="primary" disabled={!form.name.trim() || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save report"}</button></div></section></div>}{editing && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setEditing(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><Table2/></span><div><span className="eyebrow">REPORT LIBRARY</span><h2>Edit report</h2></div></div><label className="form-field"><span>Report name</span><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}/></label><label className="form-field"><span>Access</span><select value={editForm.visibility} onChange={(event) => setEditForm({ ...editForm, visibility: event.target.value })}><option value="private">Private to me</option><option value="organization">Share with workspace</option></select></label><label className="form-field"><span>Description <small>Optional</small></span><input value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}/></label><div className="modal-actions"><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={!editForm.name.trim()} onClick={() => void rename()}>Save changes</button></div></section></div>}{runHistoryReport && <div className="modal-backdrop" onMouseDown={() => setRunHistoryReport(null)}><section className="connection-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setRunHistoryReport(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><RefreshCw/></span><div><span className="eyebrow">REPORT HISTORY</span><h2>{runHistoryReport.name}</h2></div></div>{runHistoryLoading ? <PanelState status="loading" message="Loading report runs…"/> : runHistory.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Started</th><th>Version</th><th>Status</th><th>Rows</th><th>Result</th></tr></thead><tbody>{runHistory.map((run) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString("en-GB")}</td><td>v{run.definition_version}</td><td><strong>{run.status}</strong></td><td>{run.row_count?.toLocaleString() ?? "—"}</td><td>{run.status === "failed" ? run.error_message || "Report failed" : run.completed_at ? `Completed ${new Date(run.completed_at).toLocaleTimeString("en-GB")}` : "In progress"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><RefreshCw/><strong>No report runs yet</strong><span>Open this saved report to create its first tracked run.</span></div>}<div className="modal-actions"><button onClick={() => setRunHistoryReport(null)}>Close</button><button className="primary" onClick={() => { const report = runHistoryReport; setRunHistoryReport(null); void runReport(report); }}><RefreshCw/> Run again</button></div></section></div>}</>;
}
