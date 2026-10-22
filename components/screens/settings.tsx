"use client";

import { WarehouseCostSettings } from "@/components/settings/warehouse-costs";
import { useCallback, useEffect, useState } from "react";
import { WeeklyReportSettings } from "@/components/weekly-report-settings";
import { SyncScheduleSettings } from "@/components/sync-schedule-settings";
import { CircleDollarSign, KeyRound, Trash2 } from "lucide-react";
import { PanelState } from "@/components/ui/panel-state";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormGrid, SelectInput, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";

type ExchangeRateRow = { id: string; base_currency: string; quote_currency: string; rate: string; effective_date: string; source: string; notes: string | null; updated_at: string };

type ConnectionAuditEvent = { id: string; provider: "meta" | "shopify" | "google_ads" | "klaviyo"; action: "credential_created" | "credential_rotated" | "connection_deleted" | "scopes_updated"; actor_user_id: string; metadata: { scope_count?: number }; created_at: string };

type StoreCostDefaults = { fulfilmentAmount: string; fulfilmentBasis: "orders" | "units"; postageAmount: string; postageBasis: "orders" | "units"; defaultCogsPercent: string; businessContributionMarginPercent: string; currency: string };

export function SettingsView() {
  const { toast } = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
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
      toast({ title: "Cost defaults saved", tone: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save cost defaults"); } finally { setSavingDefaults(false); }
  };
  const saveAverageOrderValue = async () => {
    setSavingAverageOrderValue(true); setError("");
    try {
      const response = await fetch("/api/settings/lead-economics", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ averageOrderValue }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save average order value");
      setAverageOrderValue(String(payload.averageOrderValue));
      toast({ title: "Average order value saved", tone: "success" });
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
      toast({ title: "Exchange rate saved", tone: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save exchange rate"); } finally { setSaving(false); }
  };
  const deleteRate = async (id: string) => {
    setError("");
    const response = await fetch(`/api/settings/exchange-rates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json(); setError(payload.error || "Could not delete exchange rate"); return; }
    await loadRates();
    toast({ title: "Exchange rate deleted", tone: "success" });
  };
  const rateColumns: Column<ExchangeRateRow>[] = [
    { key: "date", header: "Effective date", sortValue: (rate) => rate.effective_date, render: (rate) => new Date(`${rate.effective_date}T00:00:00Z`).toLocaleDateString("en-GB") },
    { key: "conversion", header: "Conversion", sortValue: (rate) => `${rate.base_currency}${rate.quote_currency}`, render: (rate) => <strong className="font-semibold">1 {rate.base_currency} = {Number(rate.rate).toLocaleString("en-GB", { maximumFractionDigits: 10 })} {rate.quote_currency}</strong>, csv: (rate) => `1 ${rate.base_currency} = ${rate.rate} ${rate.quote_currency}` },
    { key: "source", header: "Source", sortValue: (rate) => rate.source },
    { key: "notes", header: "Notes", render: (rate) => rate.notes || "—", csv: (rate) => rate.notes ?? "" },
    { key: "actions", header: "", render: (rate) => canManage ? <Button variant="ghost" size="icon" aria-label={`Delete the ${rate.base_currency} rate effective ${rate.effective_date}`} onClick={() => void deleteRate(rate.id)}><Trash2/></Button> : null },
  ];
  const providerName = (provider: ConnectionAuditEvent["provider"]) => provider === "google_ads" ? "Google Ads" : provider.charAt(0).toUpperCase() + provider.slice(1);
  const actionNames = { credential_created: "Credential created", credential_rotated: "Credential rotated", connection_deleted: "Connection deleted", scopes_updated: "Shopify scopes updated" } as const;
  const auditColumns: Column<ConnectionAuditEvent>[] = [
    { key: "time", header: "Time", sortValue: (event) => event.created_at, render: (event) => new Date(event.created_at).toLocaleString("en-GB") },
    { key: "provider", header: "Provider", sortValue: (event) => providerName(event.provider), render: (event) => providerName(event.provider) },
    { key: "action", header: "Action", sortValue: (event) => actionNames[event.action], render: (event) => <strong className="font-semibold">{actionNames[event.action]}</strong>, csv: (event) => actionNames[event.action] },
    { key: "actor", header: "Actor", render: (event) => event.actor_user_id === auditUserId ? "You" : `User …${event.actor_user_id.slice(-6)}`, csv: (event) => event.actor_user_id === auditUserId ? "You" : event.actor_user_id },
    { key: "details", header: "Details", render: (event) => event.action === "scopes_updated" ? `${event.metadata.scope_count ?? 0} scopes recorded` : "No secret values stored", csv: (event) => event.action === "scopes_updated" ? `${event.metadata.scope_count ?? 0} scopes recorded` : "No secret values stored" },
  ];
  const basisOptions = <><option value="orders">Per order</option><option value="units">Per unit</option></>;
  const saveButton = (label: string, busy: boolean, disabled: boolean, onClick: () => void) => canManage ? <div className="mt-4 flex justify-end"><Button variant="primary" size="md" loading={busy} disabled={disabled} onClick={onClick}>{label}</Button></div> : null;
  return <>
    <div className="mb-5">
      <span className="block text-ds-label uppercase text-ds-muted">Financial settings</span>
      <h2 className="mt-1 text-ds-display text-ds-ink">Store cost defaults</h2>
      <p className="mt-1 max-w-[70ch] text-ds-small text-ds-muted">Set the cost and margin assumptions used by reporting for this brand.</p>
    </div>
    {error && <PanelState status="error" title="That did not work" message={error}/>}

    <Panel eyebrow="Current brand" title="Brand settings" description="Set the active brand's name and reporting model. The navigation updates to show only the pages that model needs.">
      <FormGrid>
        <FormField label="Brand name"><TextInput value={currentBrandName} disabled={!canManage || savingBrandName} maxLength={80} onChange={(event) => setCurrentBrandName(event.target.value)} placeholder="Brand name"/></FormField>
        <FormField label="Business model" hint={businessModel === "lead_generation" ? "Shows Leads, connections and settings." : "Shows ecommerce reporting, products and customer insights."}>
          <SelectInput value={businessModel} disabled={!canManage || savingBrandName} onChange={(event) => setBusinessModel(event.target.value as "ecommerce" | "lead_generation")}><option value="ecommerce">Ecommerce</option><option value="lead_generation">Lead generation</option></SelectInput>
        </FormField>
      </FormGrid>
      {saveButton("Save brand settings", savingBrandName, deletingBrand || currentBrandName.trim().length < 2, () => void saveCurrentBrandSettings())}
      {canManage && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-ds-sm border border-ds-negative/30 bg-ds-negative-soft px-4 py-3">
        <div><strong className="block text-ds-small font-semibold text-ds-negative">Delete this brand</strong><span className="text-ds-small text-ds-ink">Deletes this brand and all of its stored data. You will switch to another brand.</span></div>
        <Button variant="danger" size="md" disabled={savingBrandName || deletingBrand} onClick={() => { setDeleteConfirmation(""); setConfirmingDelete(true); }}>Delete brand</Button>
      </div>}
    </Panel>

    <Panel eyebrow="Brands" title="Add another brand" description="Each brand has its own Shopify, Meta, Google Ads, and Klaviyo connections, costs, and reporting data.">
      <FormGrid><FormField label="Brand name"><TextInput value={brandName} disabled={!canManage || creatingBrand} maxLength={80} onChange={(event) => setBrandName(event.target.value)} placeholder="New brand"/></FormField></FormGrid>
      {saveButton("Create and switch", creatingBrand, brandName.trim().length < 2, () => void createBrand())}
    </Panel>

    {businessModel === "lead_generation" ? <>
      <Panel eyebrow="Business economics" title="Product and service contribution margin" description="Set the share of collected sales remaining after direct product or service costs, before marketing and operating costs." actions={<span className="text-ds-small text-ds-muted">{costDefaults.currency}</span>}>
        <FormGrid><FormField label="Contribution margin (%)"><TextInput inputMode="decimal" value={costDefaults.businessContributionMarginPercent} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, businessContributionMarginPercent: event.target.value })}/></FormField></FormGrid>
        {saveButton("Save margin", savingDefaults, false, () => void saveCostDefaults())}
      </Panel>
      <Panel eyebrow="Sales assumption" title="Average purchase value" description="Used with the selected GoHighLevel purchase stage to estimate revenue and earnings per lead." actions={<span className="text-ds-small text-ds-muted">{costDefaults.currency}</span>}>
        <FormGrid><FormField label="Average order / deal value"><TextInput inputMode="decimal" value={averageOrderValue} disabled={!canManage || savingAverageOrderValue} onChange={(event) => setAverageOrderValue(event.target.value)} placeholder="250"/></FormField></FormGrid>
        {saveButton("Save value", savingAverageOrderValue, !Number.isFinite(Number(averageOrderValue)) || Number(averageOrderValue) < 0, () => void saveAverageOrderValue())}
      </Panel>
    </> : <Panel eyebrow="Order economics" title="Default costs" description="Postage and fulfilment defaults apply until warehouse rates are configured below. Product shipping overrides apply only to this default method. The COGS percentage is the fallback for products without a unit cost." actions={<span className="text-ds-small text-ds-muted">{costDefaults.currency}</span>}>
      <FormGrid>
        <FormField label="Default COGS rate (%)"><TextInput inputMode="decimal" value={costDefaults.defaultCogsPercent} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, defaultCogsPercent: event.target.value })}/></FormField>
        <span aria-hidden="true" className="hidden sm:block"/>
        <FormField label="Fulfilment cost"><TextInput inputMode="decimal" value={costDefaults.fulfilmentAmount} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, fulfilmentAmount: event.target.value })}/></FormField>
        <FormField label="Fulfilment basis"><SelectInput value={costDefaults.fulfilmentBasis} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, fulfilmentBasis: event.target.value as "orders" | "units" })}>{basisOptions}</SelectInput></FormField>
        <FormField label="Postage cost"><TextInput inputMode="decimal" value={costDefaults.postageAmount} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, postageAmount: event.target.value })}/></FormField>
        <FormField label="Postage basis"><SelectInput value={costDefaults.postageBasis} disabled={!canManage} onChange={(event) => setCostDefaults({ ...costDefaults, postageBasis: event.target.value as "orders" | "units" })}>{basisOptions}</SelectInput></FormField>
      </FormGrid>
      {saveButton("Save defaults", savingDefaults, false, () => void saveCostDefaults())}
    </Panel>}
    {businessModel !== "lead_generation" && <WarehouseCostSettings/>}
    <SyncScheduleSettings/>
    <WeeklyReportSettings/>

    <div className="mb-5 mt-8">
      <span className="block text-ds-label uppercase text-ds-muted">Currency settings</span>
      <h2 className="mt-1 text-ds-display text-ds-ink">Exchange rates</h2>
      <p className="mt-1 max-w-[70ch] text-ds-small text-ds-muted">Add dated rates before Spine converts Shopify Markets orders into {reportingCurrency}. Until then, those orders remain excluded from consolidated totals.</p>
    </div>
    {canManage && <Panel eyebrow="Manual rate" title="Add or replace a dated rate">
      <FormGrid className="lg:grid-cols-3">
        <FormField label="Source currency"><TextInput value={form.baseCurrency} maxLength={3} onChange={(event) => setForm({ ...form, baseCurrency: event.target.value.toUpperCase() })}/></FormField>
        <FormField label="Reporting currency"><TextInput value={reportingCurrency} disabled/></FormField>
        <FormField label="Rate"><TextInput inputMode="decimal" value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} placeholder="0.7900000000"/></FormField>
        <FormField label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })}/></FormField>
        <FormField label="Notes" optional className="lg:col-span-2"><TextInput value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Source or rationale"/></FormField>
      </FormGrid>
      <div className="mt-4 flex justify-end"><Button variant="primary" size="md" loading={saving} disabled={!form.rate || form.baseCurrency.length !== 3} onClick={() => void saveRate()}>Save rate</Button></div>
    </Panel>}
    <Panel eyebrow="Rate history" title="Effective-dated conversions" description="One unit of source currency equals the listed reporting-currency amount." flush>
      <DataTable caption="Exchange rates" columns={rateColumns} rows={rates} rowKey={(rate) => rate.id} loading={loading} exportName="exchange-rates.csv"
        empty={<EmptyState icon={<CircleDollarSign/>} title="No exchange rates yet" description="Foreign-currency orders remain excluded until a dated rate is available."/>}/>
    </Panel>
    {canManage && <Panel eyebrow="Connection security" title="Credential audit history" description="Owner/admin view. Secret values are never recorded." flush>
      <DataTable caption="Credential audit history" columns={auditColumns} rows={connectionAudit} rowKey={(event) => event.id} loading={auditLoading} exportName="credential-audit.csv"
        empty={<EmptyState icon={<KeyRound/>} title="No credential changes recorded yet" description="Future connection changes will appear here for owners and admins."/>}/>
    </Panel>}

    <Modal open={confirmingDelete} onClose={() => setConfirmingDelete(false)} eyebrow="Delete brand" title={`Delete ${currentBrandName || "this brand"}?`}
      footer={<><Button variant="quiet" size="md" onClick={() => setConfirmingDelete(false)}>Cancel</Button><Button variant="danger" size="md" loading={deletingBrand} disabled={deleteConfirmation.trim() !== currentBrandName.trim() || !currentBrandName.trim()} onClick={() => void deleteCurrentBrand()}>Delete brand permanently</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-ds-body text-ds-ink">This permanently removes the brand&apos;s connections, imported data, costs and reports. This cannot be undone.</p>
        <FormField label={`Type "${currentBrandName}" to confirm`}><TextInput value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off"/></FormField>
      </div>
    </Modal>
  </>;
}
