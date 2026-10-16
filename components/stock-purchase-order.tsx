"use client";
import { useState } from "react";
import { Download, Printer, Save, Trash2 } from "lucide-react";
import { csvText, type PurchaseOrder } from "@/lib/stock/planning";
import styles from "@/components/screens/stock.module.css";

export function downloadStockCsv(name: string, rows: (string | number | null)[][]) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = name.replace(/[^a-zA-Z0-9_.-]/g, "_"); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function StockPurchaseOrder({ initial, storeId, storeName, destinations, canManage, onSaved }: {
  initial: PurchaseOrder; storeId: string; storeName: string; destinations: string[]; canManage: boolean; onSaved: (order: PurchaseOrder) => void;
}) {
  const [po, setPo] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saved = !!po.id;
  const total = po.lines.reduce((sum, line) => sum + line.quantity * (line.unitCost ?? 0), 0);
  const missingCosts = po.lines.some((line) => line.unitCost === null);
  const valid = po.supplier.trim() && po.warehouse.trim() && po.reference.trim() && /^[A-Z]{3}$/.test(po.currency) && po.lines.length > 0 && po.lines.every((line) => Number.isSafeInteger(line.quantity) && line.quantity > 0 && (line.unitCost === null || Number.isFinite(line.unitCost) && line.unitCost >= 0));
  const exportCsv = () => downloadStockCsv(`${po.reference}.csv`, [
    ["PO reference", "Store", "Supplier", "Deliver to", "Expected date", "Currency", "SKU", "Product", "Variant", "Quantity", "Unit cost", "Line total", "Notes"],
    ...po.lines.map((line) => [po.reference, storeName, po.supplier, po.warehouse, po.expected_date, po.currency, line.sku, line.title, line.variant, line.quantity, line.unitCost, line.unitCost === null ? null : Number((line.quantity * line.unitCost).toFixed(2)), po.notes]),
  ]);
  const print = () => {
    const popup = window.open("", "_blank");
    if (!popup) { setError("Allow pop-ups to open the printable purchase order."); return; }
    popup.opener = null;
    const escape = (value: string | number | null) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(po.reference)}</title><style>body{font:14px Arial,sans-serif;color:#172033;margin:48px}h1{font-size:28px}header{border-bottom:3px solid #7058e8;padding-bottom:20px}table{border-collapse:collapse;width:100%;margin:30px 0}td,th{text-align:left;padding:12px 6px;border-bottom:1px solid #ddd}small{color:#667085}pre{font:inherit;white-space:pre-wrap}tr{break-inside:avoid}@page{margin:18mm} @media print{body{margin:0}}</style></head><body><header><small>${escape(storeName)} · DRAFT PURCHASE ORDER</small><h1>${escape(po.reference)}</h1><p>Supplier: ${escape(po.supplier)}</p><p>Deliver to: ${escape(po.warehouse)}</p><p>Expected arrival: ${escape(po.expected_date || "To be confirmed")}</p></header><table><thead><tr><th>SKU / Product</th><th>Quantity</th><th>Unit cost (${escape(po.currency)})</th><th>Amount</th></tr></thead><tbody>${po.lines.map((line) => `<tr><td>${escape(line.sku)}<br>${escape(line.title)}<br><small>${escape(line.variant)}</small></td><td>${line.quantity}</td><td>${line.unitCost === null ? "To confirm" : line.unitCost.toFixed(2)}</td><td>${line.unitCost === null ? "To confirm" : (line.unitCost * line.quantity).toFixed(2)}</td></tr>`).join("")}</tbody></table><h3>${missingCosts ? "Known subtotal" : "Subtotal"}: ${escape(po.currency)} ${total.toFixed(2)}</h3><p><small>Tax and freight excluded.${missingCosts ? " Some unit costs need confirmation." : ""}</small></p><pre>${escape(po.notes)}</pre></body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  };
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/stock/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...po, storeId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save purchase order");
      setPo(payload.order); onSaved(payload.order);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save purchase order"); }
    finally { setSaving(false); }
  };
  return <article className={styles.order}>
    <div className={styles.heading}><div><span className="eyebrow">{saved ? "SAVED DRAFT" : "REVIEW PURCHASE ORDER"}</span><h2>{po.supplier || "Choose supplier"}</h2><p>{storeName} · {po.lines.length} lines · {po.lines.reduce((sum, line) => sum + line.quantity, 0).toLocaleString()} units</p></div><div className={styles.actions}>
      <button disabled={!valid} onClick={exportCsv}><Download size={16}/> Export CSV</button>
      <button disabled={!valid} onClick={print}><Printer size={16}/>Print / PDF</button>
      {!saved && canManage && <button disabled={!valid || saving} className={styles.primary} onClick={() => void save()}><Save size={16}/>{saving ? "Saving…" : "Save draft"}</button>}
    </div></div>
    <div className={styles.filters}>
      <label>PO reference<input maxLength={100} disabled={saved} value={po.reference} onChange={(e) => setPo({ ...po, reference: e.target.value })}/></label>
      <label>Supplier<input maxLength={200} disabled={saved} value={po.supplier} onChange={(e) => setPo({ ...po, supplier: e.target.value })}/></label>
      <label>Deliver to<select disabled={saved} value={po.warehouse} onChange={(e) => setPo({ ...po, warehouse: e.target.value })}><option value="">Choose warehouse</option>{[...new Set([...destinations, ...(po.warehouse ? [po.warehouse] : [])])].map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>Currency<input maxLength={3} disabled={saved} value={po.currency} onChange={(e) => setPo({ ...po, currency: e.target.value.toUpperCase() })}/></label>
      <label>Expected arrival<input type="date" disabled={saved} value={po.expected_date ?? ""} onChange={(e) => setPo({ ...po, expected_date: e.target.value || null })}/></label>
    </div>
    <div className={styles.scroll}><table><thead><tr><th>Product</th><th>SKU</th><th>Quantity</th><th>Unit cost ({po.currency})</th><th>Line total</th>{!saved && <th>Remove</th>}</tr></thead><tbody>{po.lines.map((line, index) => <tr key={line.variantId}>
      <td><div className={styles.product}>{line.image && <img src={line.image} width={44} height={44} alt="" loading="lazy" referrerPolicy="no-referrer"/>}<span><strong>{line.title}</strong><small>{line.variant === "Default Title" ? "" : line.variant}</small></span></div></td><td>{line.sku || "No SKU"}</td>
      <td><input aria-label={`Order quantity for ${line.sku || line.title}`} type="number" min={1} max={10000000} step={1} disabled={saved} value={line.quantity} onChange={(e) => setPo({ ...po, lines: po.lines.map((l, i) => i === index ? { ...l, quantity: Number(e.target.value) } : l) })}/></td>
      <td><input aria-label={`Unit cost for ${line.sku || line.title}`} type="number" min={0} step="0.01" disabled={saved} placeholder="Add cost" value={line.unitCost ?? ""} onChange={(e) => setPo({ ...po, lines: po.lines.map((l, i) => i === index ? { ...l, unitCost: e.target.value === "" ? null : Number(e.target.value) } : l) })}/></td>
      <td>{line.unitCost === null ? "Cost needed" : (line.unitCost * line.quantity).toFixed(2)}</td>
      {!saved && <td><button aria-label={`Remove ${line.title}`} onClick={() => setPo({ ...po, lines: po.lines.filter((_, i) => i !== index) })}><Trash2 size={15}/></button></td>}
    </tr>)}</tbody></table></div>
    <label className={styles.notes}>Delivery address / supplier notes<textarea maxLength={4000} disabled={saved} value={po.notes} onChange={(e) => setPo({ ...po, notes: e.target.value })}/></label>
    <div className={styles.orderTotal}><strong>{missingCosts ? "Known subtotal" : "Subtotal"}: {po.currency} {total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><small>{missingCosts ? "Add missing unit costs before sending to your supplier. " : ""}Tax and freight excluded. Drafts do not update Shopify incoming stock or send to suppliers.</small></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </article>;
}
