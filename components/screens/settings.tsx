"use client";

import { useCallback, useEffect, useState } from "react";
import { WeeklyReportSettings } from "@/components/weekly-report-settings";
import { SyncScheduleSettings } from "@/components/sync-schedule-settings";
import { CircleDollarSign, KeyRound, Trash2 } from "lucide-react";
import { PanelState } from "@/components/ui/panel-state";

type ExchangeRateRow = { id: string; base_currency: string; quote_currency: string; rate: string; effective_date: string; source: string; notes: string | null; updated_at: string };

type ConnectionAuditEvent = { id: string; provider: "meta" | "shopify" | "google_ads" | "klaviyo"; action: "credential_created" | "credential_rotated" | "connection_deleted" | "scopes_updated"; actor_user_id: string; metadata: { scope_count?: number }; created_at: string };

type StoreCostDefaults = { fulfilmentAmount: string; fulfilmentBasis: "orders" | "units"; postageAmount: string; postageBasis: "orders" | "units"; defaultCogsPercent: string; businessContributionMarginPercent: string; currency: string };

export function SettingsView() {
  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [connectionAudit, setConnectionAudit] = useState<ConnectionAuditEvent[]>([]);
  const [auditUserId, setAuditUserId] = useState("");
  const [auditLoading, setAuditLoading] = useState(true);
  const [reportingCurrency, setReportingCurrency] = useState("GBP");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [savingAverageOrderValue, setSavingAverageOrderValue] = useState(false);
  const [averageOrderValue, setAverageOrderValue] = useState("0");
  const [creatingBrand, setCreatingBrand] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [currentBrandName, setCurrentBrandName] = useState("");
  const [businessModel, setBusinessModel] = useState<"ecommerce" | "lead_generation">("ecommerce");
  const [savingBrandName, setSavingBrandName] = useState(false);
  const [deletingBrand, setDeletingBrand] = useState(false);
  const [error, setError] = useState("");
  const [costDefaults, setCostDefaults] = useState<StoreCostDefaults>({ fulfilmentAmount: "0", fulfilmentBasis: "orders", postageAmount: "0", postageBasis: "orders", defaultCogsPercent: "0", businessContributionMarginPercent: "0", currency: "GBP" });
  const [form, setForm] = useState({ baseCurrency: "USD", rate: "", effectiveDate: new Date().toISOString().slice(0, 10), notes: "" });
  const loadRates = useCallback(() => fetch("/api/settings/exchange-rates").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load exchange rates"); setRates(payload.rates ?? []); setReportingCurrency(payload.reportingCurrency || "GBP"); setCanManage(Boolean(payload.canManage)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load exchange rates")).finally(() => setLoading(false)), []);
  useEffect(() => { void loadRates(); }, [loadRates]);
  const loadCostDefaults = useCallback(() => fetch("/api/settings/cost-defaults").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load cost defaults"); setCostDefaults(payload.defaults); setCanManage(Boolean(payload.canManage)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load cost defaults")), []);
  useEffect(() => { void loadCostDefaults(); }, [loadCostDefaults]);
  useEffect(() => { fetch("/api/settings/lead-economics").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load lead economics"); setAverageOrderValue(String(payload.averageOrderValue ?? 0)); setCanManage(Boolean(payload.canManage)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load lead economics")); }, []);
  useEffect(() => { fetch("/api/workspace").then((response) => response.ok ? response.json() : null).then((payload) => { const store = payload?.stores?.find((item: { id: string }) => item.id === payload.activeStoreId); setCurrentBrandName(store?.name ?? ""); setBusinessModel(store?.businessModel === "lead_generation" ? "lead_generation" : "ecommerce"); }).catch(() => undefined); }, []);
  const saveCostDefaults = async () => {
    setSavingDefaults(true); setError("");
    try {
      const response = await fetch("/api/settings/cost-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(costDefaults) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save cost defaults");
      setCostDefaults(payload.defaults);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save cost defaults"); } finally { setSavingDefaults(false); }
  };
  const saveAverageOrderValue = async () => {
    setSavingAverageOrderValue(true); setError("");
    try {
      const response = await fetch("/api/settings/lead-economics", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ averageOrderValue }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save average order value");
      setAverageOrderValue(String(payload.averageOrderValue));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save average order value"); } finally { setSavingAverageOrderValue(false); }
  };
  const loadConnectionAudit = useCallback(() => fetch("/api/settings/connection-audit").then(async (response) => { if (response.status === 403) return null; const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load connection security history"); setConnectionAudit(payload.events ?? []); setAuditUserId(payload.currentUserId ?? ""); return payload; }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load connection security history")).finally(() => setAuditLoading(false)), []);
  useEffect(() => { const timeout = window.setTimeout(() => void loadConnectionAudit(), 0); return () => window.clearTimeout(timeout); }, [loadConnectionAudit]);
  const saveCurrentBrandSettings = async () => {
    setSavingBrandName(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: currentBrandName, businessModel }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save brand settings");
      setCurrentBrandName(payload.store.name);
      setBusinessModel(payload.store.business_model === "lead_generation" ? "lead_generation" : "ecommerce");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save brand settings"); }
    finally { setSavingBrandName(false); }
  };
  const deleteCurrentBrand = async () => {
    const confirmed = window.confirm(`Delete "${currentBrandName || "this brand"}"? This permanently removes its connections, imported data, costs and reports. This cannot be undone.`);
    if (!confirmed) return;
    setDeletingBrand(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not delete this brand");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this brand"); }
    finally { setDeletingBrand(false); }
  };
  const createBrand = async () => {
    setCreatingBrand(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: brandName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create brand");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create brand"); setCreatingBrand(false); }
  };
  const saveRate = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/exchange-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, quoteCurrency: reportingCurrency }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save exchange rate");
      setForm({ ...form, rate: "", notes: "" }); await loadRates();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save exchange rate"); } finally { setSaving(false); }
  };
  const deleteRate = async (id: string) => {
    setError("");
    const response = await fetch(`/api/settings/exchange-rates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json(); setError(payload.error || "Could not delete exchange rate"); return; }
    await loadRates();
  };
  return <><section className="cost-toolbar"><div><span className="eyebrow">FINANCIAL SETTINGS</span><h2>Store cost defaults</h2><p>Set the cost and margin assumptions used by reporting for this brand.</p></div></section>{error && <div className="connection-error cost-error">{error}</div>}<section className="panel report-panel brand-settings" data-business-model={businessModel}><div className="panel-head"><div><span className="eyebrow">CURRENT BRAND</span><h2>Brand settings</h2><p>Set the active brand&apos;s name and reporting model. The navigation updates to show only the pages that model needs.</p></div></div><div className="filter-row"><label>Brand name<input value={currentBrandName} disabled={!canManage || savingBrandName} maxLength={80} onChange={(event) => setCurrentBrandName(event.target.value)} placeholder="Brand name"/></label><label>Business model<select value={businessModel} disabled={!canManage || savingBrandName} onChange={(event) => setBusinessModel(event.target.value as "ecommerce" | "lead_generation")}><option value="ecommerce">Ecommerce</option><option value="lead_generation">Lead generation</option></select><small>{businessModel === "lead_generation" ? "Shows Leads, connections and settings." : "Shows ecommerce reporting, products and customer insights."}</small></label>{canManage && <button className="primary" disabled={savingBrandName || deletingBrand || currentBrandName.trim().length < 2} onClick={() => void saveCurrentBrandSettings()}>{savingBrandName ? "Saving…" : "Save brand settings"}</button>}</div>{canManage && <div className="brand-danger"><div><strong>Delete this brand</strong><span>Deletes this brand and all of its stored data. You will switch to another brand.</span></div><button className="danger-button" disabled={savingBrandName || deletingBrand} onClick={() => void deleteCurrentBrand()}>{deletingBrand ? "Deleting…" : "Delete brand"}</button></div>}</section><section className="panel report-panel brand-settings"><div className="panel-head"><div><span className="eyebrow">BRANDS</span><h2>Add another brand</h2><p>Each brand has its own Shopify, Meta, Google Ads, and Klaviyo connections, costs, and reporting data.</p></div></div><div className="filter-row"><label>Brand name<input value={brandName} disabled={!canManage || creatingBrand} maxLength={80} onChange={(event) => setBrandName(event.target.value)} placeholder="New brand"/></label>{canManage && <button className="primary" disabled={creatingBrand || brandName.trim().length < 2} onClick={() => void createBrand()}>{creatingBrand ? "Creating…" : "Create and switch"}</button>}</div></section>{businessModel === "lead_generation" ? <><section className="panel report-panel lead-gen-economics"><div className="panel-head"><div><span className="eyebrow">BUSINESS ECONOMICS</span><h2>Product and service contribution margin</h2><p>Set the share of collected sales remaining after direct product or service costs, before marketing and operating costs.</p></div><span className="report-note">{costDefaults.currency}</span></div><div className="filter-row"><label>Contribution margin (%)<input inputMode="decimal" min="0" max="100" value={costDefaults.businessContributionMarginPercent} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, businessContributionMarginPercent: event.target.value })}/></label>{canManage && <button className="primary" disabled={savingDefaults} onClick={() => void saveCostDefaults()}>{savingDefaults ? "Saving…" : "Save margin"}</button>}</div></section><section className="panel report-panel lead-gen-economics"><div className="panel-head"><div><span className="eyebrow">SALES ASSUMPTION</span><h2>Average purchase value</h2><p>Used with the selected GoHighLevel purchase stage to estimate revenue and earnings per lead.</p></div><span className="report-note">{costDefaults.currency}</span></div><div className="filter-row"><label>Average order / deal value<input inputMode="decimal" min="0" max="1000000000" value={averageOrderValue} disabled={!canManage || savingAverageOrderValue} onChange={(event) => setAverageOrderValue(event.target.value)} placeholder="250"/></label>{canManage && <button className="primary" disabled={savingAverageOrderValue || !Number.isFinite(Number(averageOrderValue)) || Number(averageOrderValue) < 0} onClick={() => void saveAverageOrderValue()}>{savingAverageOrderValue ? "Saving…" : "Save value"}</button>}</div></section></> : <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">ORDER ECONOMICS</span><h2>Fulfilment and postage</h2><p>Product shipping overrides take priority over the postage default. Use the COGS rate only when a product does not have its own Shopify or manual unit cost.</p></div><span className="report-note">{costDefaults.currency}</span></div><div className="filter-row"><label>Default COGS rate (%)<input inputMode="decimal" min="0" max="100" value={costDefaults.defaultCogsPercent} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, defaultCogsPercent: event.target.value })}/></label><label>Fulfilment cost<input inputMode="decimal" min="0" value={costDefaults.fulfilmentAmount} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, fulfilmentAmount: event.target.value })}/></label><label>Fulfilment basis<select value={costDefaults.fulfilmentBasis} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, fulfilmentBasis: event.target.value as "orders" | "units" })}><option value="orders">Per order</option><option value="units">Per unit</option></select></label><label>Postage cost<input inputMode="decimal" min="0" value={costDefaults.postageAmount} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, postageAmount: event.target.value })}/></label><label>Postage basis<select value={costDefaults.postageBasis} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, postageBasis: event.target.value as "orders" | "units" })}><option value="orders">Per order</option><option value="units">Per unit</option></select></label>{canManage && <button className="primary" disabled={savingDefaults} onClick={() => void saveCostDefaults()}>{savingDefaults ? "Saving…" : "Save defaults"}</button>}</div></section>}<SyncScheduleSettings/><WeeklyReportSettings/><section className="cost-toolbar"><div><span className="eyebrow">CURRENCY SETTINGS</span><h2>Exchange rates</h2><p>Add dated rates before Spine converts Shopify Markets orders into {reportingCurrency}. Until then, those orders remain excluded from consolidated totals.</p></div></section>{canManage && <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">MANUAL RATE</span><h2>Add or replace a dated rate</h2></div></div><div className="filter-row"><label>Source currency<input value={form.baseCurrency} maxLength={3} onChange={(event) => setForm({ ...form, baseCurrency: event.target.value.toUpperCase() })}/></label><label>Reporting currency<input value={reportingCurrency} disabled/></label><label>Rate<input inputMode="decimal" value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} placeholder="0.7900000000"/></label><label>Effective date<input type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })}/></label><label>Notes<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional source or rationale"/></label><button className="primary" disabled={saving || !form.rate || form.baseCurrency.length !== 3} onClick={() => void saveRate()}>{saving ? "Saving…" : "Save rate"}</button></div></section>}<section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">RATE HISTORY</span><h2>Effective-dated conversions</h2></div><span className="report-note">One unit of source currency equals the listed reporting-currency amount.</span></div>{loading ? <PanelState status="loading" message="Loading exchange rates…"/> : rates.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Effective date</th><th>Conversion</th><th>Source</th><th>Notes</th><th/></tr></thead><tbody>{rates.map((rate) => <tr key={rate.id}><td>{new Date(`${rate.effective_date}T00:00:00Z`).toLocaleDateString("en-GB")}</td><td><strong>1 {rate.base_currency} = {Number(rate.rate).toLocaleString("en-GB", { maximumFractionDigits: 10 })} {rate.quote_currency}</strong></td><td>{rate.source}</td><td>{rate.notes || "—"}</td><td>{canManage && <button className="icon-button" title="Delete rate" onClick={() => void deleteRate(rate.id)}><Trash2/></button>}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><CircleDollarSign/><strong>No exchange rates yet</strong><span>Foreign-currency orders remain excluded until a dated rate is available.</span></div>}</section>{canManage && <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CONNECTION SECURITY</span><h2>Credential audit history</h2></div><span className="report-note">Owner/admin view · secret values are never recorded.</span></div>{auditLoading ? <PanelState status="loading" message="Loading credential history…"/> : connectionAudit.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Time</th><th>Provider</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>{connectionAudit.map((event) => <tr key={event.id}><td>{new Date(event.created_at).toLocaleString("en-GB")}</td><td>{event.provider === "google_ads" ? "Google Ads" : event.provider.charAt(0).toUpperCase() + event.provider.slice(1)}</td><td><strong>{({ credential_created: "Credential created", credential_rotated: "Credential rotated", connection_deleted: "Connection deleted", scopes_updated: "Shopify scopes updated" } as const)[event.action]}</strong></td><td>{event.actor_user_id === auditUserId ? "You" : `User …${event.actor_user_id.slice(-6)}`}</td><td>{event.action === "scopes_updated" ? `${event.metadata.scope_count ?? 0} scopes recorded` : "No secret values stored"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><KeyRound/><strong>No credential changes recorded yet</strong><span>Future connection changes will appear here for owners and admins.</span></div>}</section>}</>;
}
