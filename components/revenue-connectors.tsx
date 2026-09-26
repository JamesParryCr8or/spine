"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { revenueHeaders, type RevenueEntry } from "@/lib/revenue/schema";
import styles from "./revenue.module.css";

type Status = { storeId: string; connections: Array<{ provider: string; external_account_name: string; status: string }>; settings: Array<{ provider: string; settings: { spreadsheetId?: string; tab?: string; phase?: string; cursor?: string; done?: boolean }; last_synced_at?: string; last_error?: string }>; configured: { stripe: boolean; google_sheets: boolean }; canEdit: boolean; canConnect: boolean };
type Preview = { entries: RevenueEntry[]; count: number; digest: string; source: "csv" | "google_sheets" };
async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Your session expired. Sign in again to manage connectors.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function RevenueConnectors({ onImported }: { onImported?: () => void }) {
  const stopped = useRef(false);
  useEffect(() => { stopped.current=false; return () => { stopped.current=true; }; }, []);
  const [status, setStatus] = useState<Status | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState(""), [name, setName] = useState(""), [sheetId, setSheetId] = useState(""), [tab, setTab] = useState("Entries"), [preview, setPreview] = useState<Preview | null>(null);
  const load = useCallback(async () => {
    const next = await api("/api/revenue/connectors", undefined, "GET") as Status;
    setStatus(next);
    const saved = next.settings.find(s => s.provider === "google_sheets")?.settings;
    if (saved?.spreadsheetId) setSheetId(saved.spreadsheetId);
    if (saved?.tab) setTab(saved.tab);
  }, []);
  useEffect(() => { let active=true; void api("/api/revenue/connectors", undefined, "GET").then((next: Status) => { if (!active) return; setStatus(next); const saved=next.settings.find(s=>s.provider==="google_sheets")?.settings; if(saved?.spreadsheetId)setSheetId(saved.spreadsheetId);if(saved?.tab)setTab(saved.tab); }).catch(error => {if(active)setMessage(error.message);}); return()=>{active=false;}; }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); } finally { setBusy(false); } };
  const connected = (provider: string) => status?.connections.find(c => c.provider === provider && c.status === "connected");
  const disabled = busy || !status?.canEdit;
  const importBody = (source: Preview["source"]) => source === "csv" ? { csv, name, storeId: status?.storeId } : { spreadsheetId: sheetId, tab, storeId: status?.storeId };
  const endpoint = (source: Preview["source"]) => source === "csv" ? "/api/revenue/import" : "/api/revenue/sheets";
  const doPreview = (source: Preview["source"]) => run(async () => { setPreview({ ...await api(endpoint(source), importBody(source)), source }); });
  const syncStripe = () => run(async () => {
    let page: { done?: boolean; phase?: string; cursor?: string | null } = status?.settings.find(s => s.provider === "stripe")?.settings || {};
    if (page.done) page = {};
    let count = 0;
    do {
      if(stopped.current)return;
      const next = await api("/api/revenue/stripe/sync", { phase: page.phase, cursor: page.cursor, storeId: status?.storeId });
      count += next.imported; page = next;
      setMessage(`Stripe: ${count.toLocaleString()} records checked. ${page.done ? "Import complete." : "Keep this page open while importing…"}`);
    } while (!page.done);
    await load(); onImported?.();
  });
  const download = () => {
    const url = URL.createObjectURL(new Blob([revenueHeaders.join(",") + "\r\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "spine-external-sales-costs.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return <section className={styles.root}>
    <div className={styles.heading}><div><span className="eyebrow">COLLECTED REVENUE</span><h2>Sales & cost connectors</h2><p>Bring together Stripe receipts, cash sales and external costs. Imported receipts stay separate from GHL opportunity values.</p></div></div>
    {message && <p className={styles.notice} role="status">{message}</p>}
    <div className={styles.grid}>
      <article className={styles.card}><span className={styles.badge}>STRIPE CONNECT</span><h3>Stripe payments</h3><p>{connected("stripe")?.external_account_name || "Connect your live Stripe account with OAuth."}</p><p>Imports successful payments and refunds. Spine uses the connection for reporting; Stripe fees are not included in these receipts.</p><div className={styles.actions}>
        {status?.configured.stripe && status.canConnect ? <a href="/api/revenue/connect/stripe/authorize">{connected("stripe") ? "Reconnect Stripe" : "Connect Stripe"}</a> : <span>{status?.canConnect ? "OAuth setup required on server" : "View only"}</span>}
        {connected("stripe") && <button disabled={busy || !status?.canConnect} onClick={() => void syncStripe()}>Import payments & refunds</button>}
      </div>{status?.settings.find(s => s.provider === "stripe")?.last_synced_at && <small>Last complete sync: {new Date(status.settings.find(s => s.provider === "stripe")!.last_synced_at!).toLocaleString()}</small>}</article>
      <article className={styles.card}><span className={styles.badge}>GOOGLE SHEETS</span><h3>Your external sales ledger</h3><p>Use our template or connect an existing sheet with the template columns. Import updates when you’re ready.</p><div className={styles.actions}>
        {status?.configured.google_sheets && status.canConnect ? <a href="/api/revenue/connect/google_sheets/authorize">{connected("google_sheets") ? "Reconnect Google" : "Connect Google Sheets"}</a> : <span>{status?.canConnect ? "OAuth setup required on server" : "View only"}</span>}
        {connected("google_sheets") && <button disabled={disabled} onClick={() => void run(async () => { const result = await api("/api/revenue/sheets", { action: "template", storeId: status?.storeId }); setSheetId(result.spreadsheetId); setTab("Entries"); setMessage("Template created. Use Open sheet below to enter your sales and costs."); await load(); })}>Create template</button>}
      </div><label>Spreadsheet URL or ID<input value={sheetId} onChange={e => { setSheetId(e.target.value.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] || e.target.value); setPreview(null); }}/></label><label>Entry tab<input value={tab} onChange={e => { setTab(e.target.value); setPreview(null); }}/></label><div className={styles.actions}>
        {sheetId && /^[\w-]{20,150}$/.test(sheetId) && <><a target="_blank" rel="noreferrer" href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`}>Open sheet ↗</a><a target="_blank" rel="noreferrer" href={`https://docs.google.com/spreadsheets/d/${sheetId}/copy`}>Copy sheet ↗</a></>}
        <button disabled={disabled || !connected("google_sheets")} onClick={() => void doPreview("google_sheets")}>Preview sheet import</button>
      </div></article>
      <article className={styles.card}><span className={styles.badge}>CSV IMPORT</span><h3>Cash sales & custom costs</h3><p>Use sale, refund or cost as the type, positive amounts, an ISO currency and dates as YYYY-MM-DD. Labels can be custom, such as Cash sale, Staff, Rent or Software.</p><p>Keep each external_id unchanged when correcting entries. The same ID in CSV and Sheets refers to the same entry. Do not enter Stripe receipts again here.</p><div className={styles.actions}><button onClick={download}>Download CSV template</button></div><label>CSV file<input type="file" accept=".csv,text/csv" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; setPreview(null); setCsv(""); if (!file) return; if (file.size > 2_000_000) { setMessage("Choose a CSV smaller than 2 MB"); return; } setName(file.name); void file.text().then(setCsv); }}/></label><button disabled={disabled || !csv} onClick={() => void doPreview("csv")}>Preview CSV import</button></article>
    </div>
    {preview && <article className={styles.card}><h3>Review {preview.count.toLocaleString()} entries</h3><p>First 20 entries shown. Matching IDs replace previously imported values. You can roll back this batch afterwards.</p><div className={styles.scroll}><table><thead><tr><th>ID</th><th>Date</th><th>Type / label</th><th>Amount</th></tr></thead><tbody>{preview.entries.map(e => <tr key={e.entry_key}><td>{e.external_id}</td><td>{e.entry_date}</td><td>{e.kind} · {e.label}</td><td>{new Intl.NumberFormat("en-GB", { style: "currency", currency: e.currency }).format(e.amount_minor / 10 ** (new Intl.NumberFormat("en", { style: "currency", currency: e.currency }).resolvedOptions().maximumFractionDigits ?? 2))}</td></tr>)}</tbody></table></div><div className={styles.actions}><button disabled={disabled} onClick={() => void run(async () => { const result = await api(endpoint(preview.source), { ...importBody(preview.source), digest: preview.digest, commit: true }); setPreview(null); setMessage(`Imported ${result.imported} entries.`); await load(); onImported?.(); })}>Import {preview.count} entries</button><button disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div></article>}
    {status?.canConnect && status.connections.length > 0 && <details><summary>Manage connections</summary><p>Disconnect removes saved access credentials. Existing imported revenue stays available.</p>{status.connections.map(c => <button key={c.provider} disabled={busy} onClick={() => void run(async () => { await api(`/api/revenue/connectors?provider=${c.provider}`, undefined, "DELETE"); await load(); })}>Disconnect {c.provider === "stripe" ? "Stripe" : "Google Sheets"}</button>)}</details>}
  </section>;
}
