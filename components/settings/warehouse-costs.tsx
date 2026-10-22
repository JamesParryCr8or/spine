"use client";
import { useEffect, useState } from "react";
import type { WarehouseRate } from "@/lib/analytics/warehouse-costs";

type Location = { id: string; name: string; isActive: boolean };
export function WarehouseCostSettings() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [rates, setRates] = useState<WarehouseRate[]>([]);
  const [currency, setCurrency] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const load = async () => {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/settings/warehouse-costs");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const existing: WarehouseRate[] = body.rates;
      const current: Location[] = body.locations;
      setLocations([...current, ...existing.filter((rate) => !current.some((loc) => loc.id === rate.locationId)).map((rate) => ({ id: rate.locationId, name: rate.name, isActive: false }))]);
      setRates(existing); setCurrency(body.currency); setCanManage(body.canManage);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load warehouses"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const update = (id: string, patch: Partial<WarehouseRate>) => { setSaved(false); setRates((rows) => rows.map((row) => row.locationId === id ? { ...row, ...patch } : row)); };
  const save = async () => {
    setBusy(true); setSaving(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/settings/warehouse-costs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRates(body.rates); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save costs"); }
    finally { setBusy(false); setSaving(false); }
  };
  return <section className="panel report-panel" aria-busy={busy}>
    <div className="panel-head"><div><span className="eyebrow">SHOPIFY WAREHOUSES · {currency}</span><h2>Warehouse fulfilment costs</h2></div><button type="button" className="row-action" disabled={busy} onClick={() => void load()}>Reload warehouses</button></div>
    <p>Postage is charged once per order at each warehouse, and picking per fulfilled unit. Storage and admin are optional monthly costs, prorated by calendar day. Set the start date to include historical fulfilments.</p>
    <p>Saving any warehouse rates switches reporting to this method and replaces the store postage/picking defaults, product shipping overrides and custom shipping/handling rules. Configure every warehouse used in the period; missing rates make profit provisional. Removing all warehouse rates restores the previous method.</p>
    {error && <p role="alert" className="cost-warning">{error}</p>}
    {busy && <p role="status">Loading warehouse costs…</p>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Use</th><th>Warehouse</th><th>Postage / order</th><th>Picking / unit</th><th>Storage / month</th><th>Admin / month</th><th>From</th><th>Until (optional)</th></tr></thead><tbody>{locations.map((location) => {
      const rate = rates.find((row) => row.locationId === location.id);
      return <tr key={location.id}><td><input type="checkbox" aria-label={`Configure ${location.name}`} checked={Boolean(rate)} disabled={!canManage || busy} onChange={(event) => { setSaved(false); setRates((rows) => event.target.checked ? [...rows, { locationId: location.id, name: location.name, postage: 0, picking: 0, storage: 0, admin: 0, from: new Date().toLocaleDateString("en-CA"), to: null }] : rows.filter((row) => row.locationId !== location.id)); }}/></td><td>{location.name}{!location.isActive && <small>Inactive or removed</small>}</td>{(["postage", "picking", "storage", "admin"] as const).map((key) => <td key={key}><input style={{ width: 100 }} type="number" min="0" max="1000000" step="0.0001" aria-label={`${location.name} ${key}`} disabled={!rate || !canManage || busy} value={rate?.[key] ?? ""} onChange={(event) => update(location.id, { [key]: event.target.value === "" ? 0 : Number(event.target.value) })}/></td>)}<td><input type="date" aria-label={`${location.name} start date`} disabled={!rate || !canManage || busy} value={rate?.from ?? ""} onChange={(event) => update(location.id, { from: event.target.value })}/></td><td><input type="date" aria-label={`${location.name} end date`} disabled={!rate || !canManage || busy} value={rate?.to ?? ""} onChange={(event) => update(location.id, { to: event.target.value || null })}/></td></tr>;
    })}</tbody></table></div>
    {!busy && !error && !locations.length && <p>No Shopify warehouses found.</p>}
    <div className="warehouse-cost-actions">
      <button className="warehouse-save-button" type="button" disabled={!canManage || busy} onClick={() => void save()}>
        {saving ? "Saving…" : "Save warehouse costs"}
      </button>
      {saved && <span className="warehouse-save-status" role="status">✓ Saved. Reports will recalculate using these rates.</span>}
    </div>
  </section>;
}
