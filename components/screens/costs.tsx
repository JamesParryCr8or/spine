"use client";

import { useEffect, useState } from "react";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { Download, Info, Package, Plus, Search, Upload, WalletCards, X, Trash2 } from "lucide-react";
import { downloadCsv } from "@/components/analytics/shared";
import { PanelState } from "@/components/ui/panel-state";

type CostVariant = { id: string; title: string; sku: string | null; price: string; shopify_unit_cost: string | null; currency: string; productTitle: string };

type ProductCost = { id: string; variant_id: string | null; sku: string | null; source: string; amount: string; currency: string; effective_from: string; effective_to: string | null; notes: string | null };

type ProductShippingCost = { id: string; variant_id: string | null; sku: string | null; allocation_basis: "orders" | "units"; amount: string; currency: string; effective_from: string; effective_to: string | null; notes: string | null };

type CostAuditEvent = { id: string; action: "created" | "updated" | "deleted"; previous_value: { amount?: string; effective_to?: string | null; notes?: string | null } | null; next_value: { amount?: string; effective_to?: string | null; notes?: string | null } | null; created_at: string };

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

export function Costs({ focusSku }: { focusSku?: string | null }) {
  const [variants, setVariants] = useState<CostVariant[]>([]);
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [shippingCosts, setShippingCosts] = useState<ProductShippingCost[]>([]);
  const [missingCostImpact, setMissingCostImpact] = useState({ orders: 0, units: 0, revenue: 0 });
  const [currency, setCurrency] = useState("GBP");
  const [canEdit, setCanEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddShipping, setShowAddShipping] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [costSearch, setCostSearch] = useState(focusSku ?? "");
  const [editingCost, setEditingCost] = useState<ProductCost | null>(null);
  const [auditEvents, setAuditEvents] = useState<CostAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [shippingForm, setShippingForm] = useState({ variantId: "", amount: "", allocationBasis: "units", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });
  const [editForm, setEditForm] = useState({ amount: "", effectiveTo: "", notes: "" });

  const load = () => Promise.all([
    fetch("/api/costs").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load costs"); return payload; }),
    fetch("/api/costs/shipping").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load shipping costs"); return payload; }),
  ]).then(([payload, shippingPayload]) => {
    setError(""); setVariants(payload.variants ?? []); setCosts(payload.costs ?? []); setShippingCosts(shippingPayload.costs ?? []); setMissingCostImpact(payload.missingCostImpact ?? { orders: 0, units: 0, revenue: 0 }); setCurrency(payload.currency ?? "GBP"); setCanEdit(Boolean(payload.canEdit && shippingPayload.canEdit));
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load costs"));

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!focusSku) return;
    const timeout = window.setTimeout(() => setCostSearch(focusSku), 0);
    return () => window.clearTimeout(timeout);
  }, [focusSku]);

  const saveItems = async (items: Array<Record<string, string | null>>, source: "manual" | "csv", filename?: string) => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, source, filename }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.errors?.join(" · ") || payload.error || "Could not save costs");
      await load();
      return payload.imported as number;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save costs");
      return 0;
    } finally { setSaving(false); }
  };

  const saveManual = async () => {
    const imported = await saveItems([{ variantId, amount, currency, effectiveFrom, effectiveTo: effectiveTo || null, notes: notes || null }], "manual");
    if (imported) { setShowAdd(false); setAmount(""); setEffectiveTo(""); setNotes(""); }
  };
  const saveShipping = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...shippingForm, currency, effectiveTo: shippingForm.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save shipping override");
      setShowAddShipping(false); setShippingForm({ ...shippingForm, variantId: "", amount: "", effectiveTo: "", notes: "" }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save shipping override"); } finally { setSaving(false); }
  };
  const deleteShipping = async (cost: ProductShippingCost) => {
    if (!window.confirm("Delete this shipping override?")) return;
    setError("");
    try {
      const response = await fetch(`/api/costs/shipping?id=${encodeURIComponent(cost.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete shipping override");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete shipping override"); }
  };
  const beginEdit = (cost: ProductCost) => {
    setEditingCost(cost); setEditForm({ amount: cost.amount, effectiveTo: cost.effective_to || "", notes: cost.notes || "" });
    setAuditEvents([]); setAuditLoading(true);
    fetch(`/api/costs?historyFor=${encodeURIComponent(cost.id)}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load cost history");
      setAuditEvents(payload.events ?? []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load cost history")).finally(() => setAuditLoading(false));
  };
  const saveEdit = async () => {
    if (!editingCost) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingCost.id, amount: editForm.amount, effectiveTo: editForm.effectiveTo || null, notes: editForm.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update cost");
      setEditingCost(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update cost"); } finally { setSaving(false); }
  };

  const importCsv = async (file: File) => {
    const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) { setError("The CSV needs a header and at least one data row"); return; }
    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/\s+/g, "_"));
    const required = ["sku", "amount", "effective_from"];
    const missing = required.filter((header) => !headers.includes(header));
    if (missing.length) { setError(`Missing CSV columns: ${missing.join(", ")}`); return; }
    const items = lines.slice(1).map((line) => {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
      return { sku: row.sku, amount: row.amount, currency: row.currency || currency, effectiveFrom: row.effective_from, effectiveTo: row.effective_to || null, notes: row.notes || null };
    }).filter((item) => item.sku && item.amount);
    if (!items.length) { setError("Add a cost amount beside at least one SKU before importing the template"); return; }
    await saveItems(items, "csv", file.name);
  };

  const currentDate = new Date().toISOString().slice(0, 10);
  const currentCosts = new Map(costs.filter((cost) => cost.effective_from <= currentDate && (!cost.effective_to || cost.effective_to >= currentDate)).map((cost) => [cost.variant_id ?? `sku:${cost.sku?.toLowerCase()}`, cost]));
  const currentShippingCosts = new Map(shippingCosts.filter((cost) => cost.effective_from <= currentDate && (!cost.effective_to || cost.effective_to >= currentDate)).map((cost) => [cost.variant_id ?? `sku:${cost.sku?.toLowerCase()}`, cost]));
  const staleVariants = variants.filter((variant) => {
    const key = variant.id;
    const skuKey = variant.sku ? `sku:${variant.sku.toLowerCase()}` : "";
    const records = costs.filter((cost) => cost.variant_id === key || (skuKey && `sku:${cost.sku?.toLowerCase()}` === skuKey));
    return records.length > 0 && !currentCosts.has(key) && !currentCosts.has(skuKey) && records.some((cost) => Boolean(cost.effective_to && cost.effective_to < currentDate));
  }).length;
  const covered = variants.filter((variant) => currentCosts.has(variant.id) || (variant.sku && currentCosts.has(`sku:${variant.sku.toLowerCase()}`)) || variant.shopify_unit_cost !== null).length;
  const missingVariants = variants.filter((variant) => !currentCosts.has(variant.id) && (!variant.sku || !currentCosts.has(`sku:${variant.sku.toLowerCase()}`)) && variant.shopify_unit_cost === null);
  const coverage = variants.length ? Math.round((covered / variants.length) * 100) : 0;
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const missingCostRows: Array<Array<string | number>> = [
    ["product", "variant", "sku", "amount", "currency", "effective_from", "effective_to", "notes"],
    ...missingVariants.map((variant) => [variant.productTitle, variant.title, variant.sku ?? "", "", variant.currency || currency, currentDate, "", ""]),
  ];
  const exportMissingCsv = () => downloadCsv("missing-product-cogs.csv", missingCostRows);
  const exportMissingXlsx = () => downloadXlsx("missing-product-cogs.xlsx", missingCostRows, { sheetName: "Missing COGS", headerRow: 1, columnStyles: { 4: "currency" } });
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });

  return <>
    <section className="cost-toolbar">
      <div><span className="eyebrow">COST ENGINE</span><h2>Product cost history</h2><p>Costs apply from their effective date, so future changes do not rewrite historical profit.</p></div>
      <div className="feature-actions"><button className="primary" disabled={!canEdit} onClick={()=>setShowAdd(true)}><Plus/> Add product cost</button><button disabled={!canEdit} onClick={() => setShowAddShipping(true)}><Plus/> Add shipping override</button><button disabled={missingVariants.length === 0} onClick={exportMissingCsv}><Download/> Missing COGS CSV</button><button disabled={missingVariants.length === 0} onClick={exportMissingXlsx}><Download/> Missing COGS Excel</button><label className={canEdit?"csv-button":"csv-button disabled"}><Upload/> Import CSV<input type="file" accept=".csv,text/csv" disabled={!canEdit || saving} onChange={(event)=>{const file=event.target.files?.[0];if(file) void importCsv(file);event.target.value="";}}/></label></div>
    </section>
    {error && <div className="connection-error cost-error">{error}</div>}
    <section className="cost-grid live"><div><strong>{variants.length.toLocaleString()}</strong><span>Variants synced</span></div><div><strong>{coverage}%</strong><span>Current cost coverage</span></div><div><strong>{Math.max(variants.length-covered,0).toLocaleString()}</strong><span>Missing costs</span></div><div><strong>{costs.length.toLocaleString()}</strong><span>Cost records</span></div></section>
    {missingCostImpact.orders > 0 && <div className="connection-notice cost-impact"><Info/><div><strong>Missing costs affect {formatter.format(missingCostImpact.revenue)} of imported sales</strong><span>{missingCostImpact.orders.toLocaleString()} orders and {missingCostImpact.units.toLocaleString()} units cannot yet have complete gross-profit calculations. Add an effective-dated product cost to resolve them.</span></div></div>}
    {staleVariants > 0 && <div className="connection-notice cost-impact"><Info/><div><strong>{staleVariants.toLocaleString()} product cost{staleVariants === 1 ? "" : "s"} need updating</strong><span>These variants have an expired cost record. Add a new effective-dated cost to keep future profitability up to date.</span></div></div>}
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CURRENT COVERAGE</span><h2>Variant cost coverage</h2></div><span className="report-note">Active manual costs take priority over Shopify&apos;s unit cost.</span></div>{variants.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Selling price</th><th>Shopify unit cost</th><th>Active override</th><th>Shipping override</th><th>Current source</th></tr></thead><tbody>{variants.map((variant) => { const override = currentCosts.get(variant.id) ?? (variant.sku ? currentCosts.get(`sku:${variant.sku.toLowerCase()}`) : undefined); const shippingOverride = currentShippingCosts.get(variant.id) ?? (variant.sku ? currentShippingCosts.get(`sku:${variant.sku.toLowerCase()}`) : undefined); const source = override ? override.source : variant.shopify_unit_cost !== null ? "shopify" : "missing"; return <tr key={variant.id}><td><strong>{variant.productTitle}</strong><small>{variant.title}</small></td><td>{variant.sku || "—"}</td><td>{formatter.format(Number(variant.price))}</td><td>{variant.shopify_unit_cost === null ? "—" : formatter.format(Number(variant.shopify_unit_cost))}</td><td>{override ? <strong>{formatter.format(Number(override.amount))}</strong> : "—"}</td><td>{shippingOverride ? <><strong>{formatter.format(Number(shippingOverride.amount))}</strong><small>per {shippingOverride.allocation_basis === "units" ? "unit" : "order"}</small></> : "Store fallback"}</td><td><span className={source === "missing" ? "cost-warning" : `source-pill ${source}`}>{source === "missing" ? "Needs cost" : source.replace("_", " ")}</span></td></tr>; })}</tbody></table></div> : null}</section>
    <section className="panel report-panel cost-table-panel"><div className="panel-head"><div><span className="eyebrow">EFFECTIVE-DATED RECORDS</span><h2>Product costs</h2></div><a className="template-link" href="data:text/csv;charset=utf-8,sku%2Camount%2Ccurrency%2Ceffective_from%2Ceffective_to%2Cnotes%0AEXAMPLE-SKU%2C12.50%2CGBP%2C2026-01-01%2C%2COptional%20note" download="product-cost-template.csv">Download CSV template</a></div><div className="filter-row"><div className="search"><Search/><input value={costSearch} onChange={(event) => setCostSearch(event.target.value)} placeholder="Find a product or SKU..."/></div></div>
      {variants.length===0?<div className="cost-empty"><WalletCards/><strong>No Shopify variants yet</strong><span>Connect Shopify and run the first sync before adding variant costs. CSV rows with a SKU can still be imported.</span></div>:<div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Source</th><th>Unit cost</th><th>Effective from</th><th>Effective to</th><th/></tr></thead><tbody>{costs.length===0?<tr><td colSpan={7} className="empty-row">No cost records yet. Add one manually or import the CSV template.</td></tr>:costs.filter((cost) => { const variant = cost.variant_id ? variantMap.get(cost.variant_id) : undefined; return `${variant?.productTitle ?? ""} ${variant?.title ?? ""} ${cost.sku ?? variant?.sku ?? ""}`.toLowerCase().includes(costSearch.toLowerCase()); }).map((cost)=>{const variant=cost.variant_id?variantMap.get(cost.variant_id):undefined;return <tr key={cost.id}><td><strong>{variant?.productTitle ?? "SKU fallback"}</strong><small>{variant?.title ?? cost.notes ?? "Unmatched variant"}</small></td><td>{cost.sku || variant?.sku || "—"}</td><td><span className={`source-pill ${cost.source}`}>{cost.source.replace("_"," ")}</span></td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td><td>{canEdit && <button onClick={() => beginEdit(cost)}>Edit</button>}</td></tr>})}</tbody></table></div>}
    </section>
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">SHIPPING OVERRIDES</span><h2>Variant shipping costs</h2><p>Overrides replace store-level fulfilment fallback rates for matching order lines.</p></div></div>{shippingCosts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Amount</th><th>Basis</th><th>Effective from</th><th>Effective to</th><th/></tr></thead><tbody>{shippingCosts.map((cost) => { const variant = cost.variant_id ? variantMap.get(cost.variant_id) : undefined; return <tr key={cost.id}><td><strong>{variant?.productTitle ?? "SKU fallback"}</strong><small>{variant?.title ?? cost.notes ?? "Unmatched variant"}</small></td><td>{cost.sku || variant?.sku || "—"}</td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>Per {cost.allocation_basis === "units" ? "unit" : "order"}</td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td><td>{canEdit && <button className="icon-button" aria-label="Delete shipping override" onClick={() => void deleteShipping(cost)}><Trash2/></button>}</td></tr>; })}</tbody></table></div> : <div className="cost-empty"><Package/><strong>No variant shipping overrides</strong><span>Store-level fulfilment expense rules remain the fallback until a matching override is added.</span></div>}</section>
    {showAdd&&<div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={()=>setShowAdd(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">COST ENGINE</span><h2>Add product cost</h2></div></div><p className="modal-intro">Choose a synced Shopify variant and the date this cost starts applying.</p>
      <label className="form-field"><span>Product variant</span><select value={variantId} onChange={(event)=>setVariantId(event.target.value)}><option value="">Select a variant</option>{variants.map((variant)=><option key={variant.id} value={variant.id}>{variant.productTitle} — {variant.title}{variant.sku?` (${variant.sku})`:""}</option>)}</select></label>
      <div className="cost-form-grid"><label className="form-field"><span>Unit cost</span><input inputMode="decimal" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="0.00"/></label><label className="form-field"><span>Currency</span><input value={currency} onChange={(event)=>setCurrency(event.target.value.toUpperCase())} maxLength={3}/></label><label className="form-field"><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(event)=>setEffectiveFrom(event.target.value)}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={effectiveTo} onChange={(event)=>setEffectiveTo(event.target.value)}/></label></div>
      <label className="form-field"><span>Notes <small>Optional</small></span><input value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Supplier, landed cost, or reason for change"/></label>
      {error&&<div className="connection-error">{error}</div>}<div className="modal-actions"><button onClick={()=>setShowAdd(false)}>Cancel</button><button className="primary" disabled={!variantId || !amount || saving} onClick={saveManual}>{saving?"Saving…":"Save cost"}</button></div>
    </section></div>}{showAddShipping && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowAddShipping(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><Package/></span><div><span className="eyebrow">SHIPPING COST</span><h2>Add variant override</h2></div></div><p className="modal-intro">This rate replaces store-level fulfilment fallback rules for the matching order line and date.</p><label className="form-field"><span>Product variant</span><select value={shippingForm.variantId} onChange={(event) => setShippingForm({ ...shippingForm, variantId: event.target.value })}><option value="">Select a variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productTitle} — {variant.title}{variant.sku ? ` (${variant.sku})` : ""}</option>)}</select></label><div className="cost-form-grid"><label className="form-field"><span>Shipping amount</span><input inputMode="decimal" value={shippingForm.amount} onChange={(event) => setShippingForm({ ...shippingForm, amount: event.target.value })} placeholder="0.00"/></label><label className="form-field"><span>Charge basis</span><select value={shippingForm.allocationBasis} onChange={(event) => setShippingForm({ ...shippingForm, allocationBasis: event.target.value })}><option value="units">Per unit</option><option value="orders">Per order</option></select></label><label className="form-field"><span>Effective from</span><input type="date" value={shippingForm.effectiveFrom} onChange={(event) => setShippingForm({ ...shippingForm, effectiveFrom: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={shippingForm.effectiveTo} onChange={(event) => setShippingForm({ ...shippingForm, effectiveTo: event.target.value })}/></label></div><label className="form-field"><span>Notes <small>Optional</small></span><input value={shippingForm.notes} onChange={(event) => setShippingForm({ ...shippingForm, notes: event.target.value })} placeholder="Carrier, service, or reason for override"/></label><div className="modal-actions"><button onClick={() => setShowAddShipping(false)}>Cancel</button><button className="primary" disabled={!shippingForm.variantId || !shippingForm.amount || saving} onClick={() => void saveShipping()}>{saving ? "Saving…" : "Save shipping override"}</button></div></section></div>}{editingCost && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setEditingCost(null)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">COST ENGINE</span><h2>Edit product cost</h2></div></div><p className="modal-intro">This updates the selected effective-dated record and saves an audit event.</p><div className="cost-form-grid"><label className="form-field"><span>Unit cost</span><input inputMode="decimal" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={editForm.effectiveTo} onChange={(event) => setEditForm({ ...editForm, effectiveTo: event.target.value })}/></label></div><label className="form-field"><span>Notes <small>Optional</small></span><input value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}/></label><section className="audit-history"><span className="eyebrow">AUDIT HISTORY</span>{auditLoading ? <PanelState status="loading" lines={2} message="Loading change history…"/> : auditEvents.length ? <ul>{auditEvents.map((event) => <li key={event.id}><strong>{event.action === "updated" ? "Updated" : event.action === "created" ? "Created" : "Deleted"}</strong><span>{new Date(event.created_at).toLocaleString("en-GB")}{event.action === "updated" && event.previous_value?.amount !== event.next_value?.amount ? ` · ${formatter.format(Number(event.previous_value?.amount || 0))} → ${formatter.format(Number(event.next_value?.amount || 0))}` : ""}</span></li>)}</ul> : <p>No recorded changes yet.</p>}</section><div className="modal-actions"><button onClick={() => setEditingCost(null)}>Cancel</button><button className="primary" disabled={!editForm.amount || saving} onClick={() => void saveEdit()}>{saving ? "Saving…" : "Save changes"}</button></div></section></div>}
  </>;
}
