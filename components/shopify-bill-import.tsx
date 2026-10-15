"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PanelState } from "@/components/ui/panel-state";
import { useToast } from "@/components/ui/toast";
import { invalidateCachedJson } from "@/lib/analytics/client-response-cache";
import { billingCostBucket } from "@/lib/analytics/billing-costs";

type Charge = {
  id?: string; charge_key: string; bill_number: string | null; charge_date: string;
  category: string; description: string; amount: string; currency: string;
  include_in_pnl: boolean; raw: Record<string, string>;
  status?: "new" | "updated" | "duplicate"; reporting_amount?: number | null;
};
type ChargeData = { storeId: string; storeName: string; currency: string; charges: Charge[]; includeCategories?: string[];
  exportFrom?: string; exportTo?: string;
  estimateSettings?: { enabled: boolean; overrides: Record<string, boolean> };
  estimates?: { total: number; monthsUsed: number; today: string; items: { key: string; label: string; category: string; enabled: boolean; monthlyAverage: number | null; dailyAverage: number | null; estimated: number; missingRates: boolean }[] };
  totalCount: number; unbilledCount?: number; missingRates?: number; counts?: { new: number; updated: number; duplicate: number };
  categories?: { category: string; count: number; totals: Record<string, number> }[] };
const endpoint = "/api/costs/shopify-bills";
const money = (amount: number | string, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(amount));
async function payload(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load Shopify bills");
  return result;
}

export function ShopifyBillImport({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [saved, setSaved] = useState<ChargeData | null>(null);
  const [preview, setPreview] = useState<ChargeData | null>(null);
  const [file, setFile] = useState<{ csv: string; filename: string } | null>(null);
  const [includeCategories, setIncludeCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fxLoading, setFxLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Charge | null>(null);
  const [page, setPage] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  async function load(targetPage = 0) { setSaved(await payload(await fetch(`${endpoint}?page=${targetPage}`))); }
  useEffect(() => {
    let active = true;
    async function initialLoad() {
      const data = await payload(await fetch(endpoint));
      if (!active) return;
      setSaved(data);
      if (canEdit && data.missingRates) {
        setFxLoading(true);
        const fx = await payload(await fetch(`${endpoint}/fx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: data.storeId }) }));
        invalidateCachedJson("/api/analytics/");
        const refreshed = await payload(await fetch(endpoint));
        if (active) { setSaved(refreshed); if (fx.warnings?.length) setError(fx.warnings.join(" ")); }
      }
    }
    void initialLoad().catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setFxLoading(false); });
    return () => { active = false; };
  }, [canEdit]);
  async function choose(selected: File | undefined) {
    if (!selected) return;
    setError(""); setPreview(null); setFile(null); setReviewed(false); setBusy(true); setPage(0);
    try {
      if (selected.size > 2_000_000) throw new Error("Choose a CSV smaller than 2 MB.");
      const next = { csv: await selected.text(), filename: selected.name };
      const data = await payload(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next, action: "preview" }) }));
      setFile(next); setPreview(data); setIncludeCategories(data.includeCategories ?? []);
      setExportFrom(data.exportFrom); setExportTo(data.exportTo);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview CSV"); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!file || !preview || !reviewed) return;
    setBusy(true); setError("");
    try {
      const result = await payload(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...file, action: "import", storeId: preview.storeId, includeCategories, exportFrom, exportTo }) }));
      invalidateCachedJson("/api/analytics/pnl");
      setPreview(null); setFile(null); setPage(0); await load();
      invalidateCachedJson("/api/analytics/");
      if (result.fx?.warnings?.length) setError(`Charges saved. ${result.fx.warnings.join(" ")}`);
      toast({ title: `${result.added} charges imported · ${result.promoted} updated · ${result.skipped} duplicates skipped`, tone: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed"); }
    finally { setBusy(false); }
  }
  async function toggle(charge: Charge) {
    if (!saved || !charge.id) return;
    setBusy(true); setError("");
    try {
      await payload(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: charge.id, storeId: saved.storeId, include: !charge.include_in_pnl }) }));
      invalidateCachedJson("/api/analytics/pnl"); await load(page);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update charge"); }
    finally { setBusy(false); }
  }
  const data = preview ?? saved;
  const charges = data?.charges ?? [];
  const counts = preview?.counts ?? { new: 0, updated: 0, duplicate: 0 };
  const pageCount = Math.ceil((preview ? charges.length : saved?.totalCount ?? 0) / 50);
  async function changePage(target: number) {
    if (preview) { setPage(target); return; }
    setBusy(true); setError("");
    try { await load(target); setPage(target); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load charges"); } finally { setBusy(false); }
  }
  async function cancelPreview() {
    setPreview(null); setFile(null); setPage(0); setBusy(true);
    try { await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load charges"); } finally { setBusy(false); }
  }
  async function saveEstimates(enabled: boolean, overrides: Record<string, boolean>) {
    if (!saved) return;
    setBusy(true); setError("");
    try {
      await payload(await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: saved.storeId, enabled, overrides }) }));
      invalidateCachedJson("/api/analytics/pnl"); await load(page);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save estimates"); } finally { setBusy(false); }
  }
  const included = (c: Charge) => preview && c.status === "new" ? includeCategories.includes(c.category) : c.include_in_pnl;
  const columns: Column<Charge>[] = [
    { key: "date", header: "Charge date", render: c => c.charge_date },
    { key: "bill", header: "Bill", render: c => c.bill_number ?? "Unbilled" },
    { key: "description", header: "Charge", render: c => <><strong>{c.description}</strong><span className="block text-ds-muted">{c.category.replaceAll("_", " ")}</span></> },
    { key: "amount", header: "Billed amount", numeric: true, render: c => money(c.amount, c.currency) },
    { key: "converted", header: `${data?.currency ?? "Reporting"} cost`, numeric: true, render: c => c.reporting_amount == null ? "—" : money(c.reporting_amount, data!.currency) },
    { key: "pnl", header: "P&L", render: c => !c.bill_number ? "Pending bill" : !included(c) ? "Excluded" : c.reporting_amount === null ? "Needs exchange rate" : `Included · ${billingCostBucket(c.category) === "marketing" ? "Marketing" : billingCostBucket(c.category) === "variable" ? "Variable costs" : "Fixed costs"}` },
    ...(preview ? [{ key: "status", header: "Import", render: (c: Charge) => c.status }] : []),
    { key: "actions", header: "Review", render: c => <div className="flex gap-2"><Button variant="quiet" size="sm" onClick={() => setDetail(c)}>Details</Button>{!preview && canEdit && <Button variant="quiet" size="sm" disabled={busy} onClick={() => void toggle(c)}>{c.include_in_pnl ? "Exclude" : "Include"}</Button>}</div> },
  ];
  return <Panel eyebrow="Shopify billing" title="Import Shopify charges" description="Export a detailed CSV from Shopify Settings → Billing → Statement of charges, then import it into the selected store.">
    <div className="flex flex-col gap-4">
      {error && <PanelState status="error" title="Could not complete the request" message={error}/>}
      <label className="text-ds-small font-medium">Shopify charges CSV
        <input className="mt-2 block w-full rounded border border-ds-line p-3" type="file" accept=".csv,text/csv" disabled={!canEdit || busy || fxLoading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }}/>
      </label>
      {busy && <p role="status">Processing charges…</p>}
      {fxLoading && <p role="status">Fetching historical exchange rates and updating profit costs…</p>}
      {data && <p className="text-ds-small"><strong>{data.storeName}</strong> · {data.totalCount} charges{preview ? ` · ${preview.unbilledCount} unbilled` : ""}</p>}
      {!preview && saved && <p className="text-ds-small text-ds-muted">Foreign-currency bills use automatic historical reference rates from Frankfurter, cached by charge date. Shopify’s original {saved.currency} amounts and rates entered for the same date take priority. Reference conversions exclude bank fees. Included billed costs reduce net profit in both P&amp;L and Overview.</p>}
      {!preview && !!saved?.missingRates && <p role="status" className="text-ds-small">{saved.missingRates} included billed charges still need exchange rates and are excluded from profit totals until converted. Check the FX warning or add a dated rate in Settings.</p>}
      {!preview && saved?.estimateSettings && saved.estimates && <fieldset className="rounded border border-ds-line p-4">
        <legend className="px-2 font-semibold">Current-month estimates</legend>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={busy || !canEdit} checked={saved.estimateSettings.enabled} onChange={event => void saveEstimates(event.target.checked, saved.estimateSettings!.overrides)}/>Estimate recent costs automatically</label>
        <p className="my-3 text-ds-small text-ds-muted">Uses the previous 12 completed months where full exports are available ({saved.estimates.monthsUsed} available). With less history, uses the available complete months; no history means no estimate. The monthly average is spread over this month’s days, through {saved.estimates.today}. Imported periods and billed subscription cycles replace estimates.</p>
        <p className="my-3 font-semibold">Estimated costs included this month: {money(saved.estimates.total, saved.currency)}</p>
        <div className="max-h-80 overflow-auto space-y-3">{saved.estimates.items.map(item => <label key={item.key} className="flex items-center gap-3 text-ds-small"><input type="checkbox" disabled={busy || !canEdit || !saved.estimateSettings!.enabled} checked={item.enabled} onChange={event => void saveEstimates(saved.estimateSettings!.enabled, { ...saved.estimateSettings!.overrides, [item.key]: event.target.checked })}/><span><strong>{item.label}</strong> · {item.monthlyAverage === null ? (item.missingRates ? "Needs exchange rates" : "Needs complete history") : `${money(item.monthlyAverage, saved.currency)}/month · ${money(item.dailyAverage ?? 0, saved.currency)}/day`}<span className="block text-ds-muted">{item.category.replaceAll("_", " ")}</span></span></label>)}</div>
        <p className="mt-3 text-ds-small text-ds-muted">Apps and subscriptions default on. Variable categories default off. These switches affect estimates only; imported actuals keep their own Include/Exclude setting.</p>
      </fieldset>}
      {preview && <>
        <div className="flex flex-wrap gap-4"><label className="text-ds-small">Export period starts<input className="block rounded border border-ds-line p-2" type="date" value={exportFrom} disabled={busy} onChange={event => { setExportFrom(event.target.value); setReviewed(false); }}/></label><label className="text-ds-small">Export period ends<input className="block rounded border border-ds-line p-2" type="date" value={exportTo} disabled={busy} onChange={event => { setExportTo(event.target.value); setReviewed(false); }}/></label></div>
        <p className="text-ds-small">Confirm the full date range selected in Shopify, including days with no charges. These dates replace daily estimates with imported actuals. Use a complete Statement of charges export, not an individual or filtered bill.</p>
        <p className="text-ds-small">{counts.new} new · {counts.updated} becoming billed · {counts.duplicate} duplicates skipped. Every CSV column is saved. Billed charges are counted once on their charge date; billing periods remain available in Details.</p>
        <fieldset className="rounded border border-ds-line p-4"><legend className="px-2 font-semibold">Categories to include in P&amp;L for new charges</legend>
          {preview.categories?.map(({ category, count, totals }) => {
            return <label key={category} className="my-2 flex items-center gap-3 text-ds-small"><input type="checkbox" disabled={busy} checked={includeCategories.includes(category)} onChange={event => { setReviewed(false); setIncludeCategories(current => event.target.checked ? [...current, category] : current.filter(c => c !== category)); }}/><span>{category.replaceAll("_", " ")} · {count} charges · {Object.entries(totals).map(([currency, amount]) => money(amount, currency)).join(" / ")}</span></label>;
          })}
        </fieldset>
        <p className="text-ds-small text-ds-muted">Payment and shipping charges can overlap existing fees and estimates. Existing imported charges keep their P&amp;L selection. Unbilled charges stay out of P&amp;L until a later export assigns a bill. No exchange rate is guessed.</p>
        {!!preview.missingRates && <p role="status" className="text-ds-small">Historical exchange rates will be fetched automatically when importing these {preview.missingRates} billed charges. Any unavailable conversions remain flagged for review.</p>}
        <p className="text-ds-small text-ds-muted">The table previews the first 100 charges. Category totals and import counts cover the complete file.</p>
        <p className="text-ds-small text-ds-muted">Shopify provides no unique charge ID in this export. Matching uses charge details and repeated-row counts. Import complete date ranges; review identical charges if exporting partial bills.</p>
        <label className="flex gap-2 text-ds-small"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)}/>This is the complete export for these dates. I have reviewed categories and overlapping manually entered expenses or fee estimates.</label>
        <div className="flex gap-2"><Button variant="primary" size="md" disabled={busy || !reviewed || !canEdit || !exportFrom || !exportTo} onClick={() => void commit()}>Import {counts.new} new charges{counts.updated ? ` and update ${counts.updated}` : ""}</Button><Button variant="quiet" size="md" disabled={busy} onClick={() => void cancelPreview()}>Cancel preview</Button></div>
      </>}
      <DataTable caption={preview ? "Shopify charge import preview" : "Imported Shopify charges"} columns={columns} rows={preview ? charges.slice(page * 50, (page + 1) * 50) : charges} rowKey={c => c.charge_key} empty={<p className="p-4 text-ds-muted">No imported Shopify charges yet.</p>}/>
      {pageCount > 1 && <div className="flex items-center gap-3"><Button variant="quiet" size="sm" disabled={busy || page === 0} onClick={() => void changePage(page - 1)}>Previous</Button><span>Page {page + 1} of {pageCount}</span><Button variant="quiet" size="sm" disabled={busy || page + 1 >= pageCount} onClick={() => void changePage(page + 1)}>Next</Button></div>}
    </div>
    <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Original Shopify charge" eyebrow={detail?.bill_number ? `Bill ${detail.bill_number}` : "Unbilled charge"}>
      <dl className="space-y-3">{Object.entries(detail?.raw ?? {}).map(([key, value]) => <div key={key}><dt className="text-ds-small text-ds-muted">{key}</dt><dd className="break-words">{value || "—"}</dd></div>)}</dl>
    </Modal>
  </Panel>;
}
