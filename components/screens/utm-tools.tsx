"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, Trash2 } from "lucide-react";
import { buildCampaignUrl } from "@/lib/analytics/utm-builder";
import { buildCustomSpendRows, customSpendColumnFields, parseCustomSpendCsv, type CustomSpendColumnKey, type ParsedCustomSpendCsv, type CustomSpendInputRow } from "@/lib/settings/custom-spend-csv";

type CustomSpendBatch = { id: string; original_filename: string; row_count: number; inserted_count: number; updated_count: number; rolled_back_at: string | null; created_at: string };

type CampaignMappingRow = { id: string; platform: "meta"; external_campaign_id: string; external_campaign_name: string; utm_source: string; utm_medium: string; utm_campaign: string; updated_at: string };

type CampaignMappingData = { canManage: boolean; mappings: CampaignMappingRow[]; campaigns: Array<{ campaign_id: string; campaign_name: string; account_id: string; account_name: string | null; currency: string }> };

/**
 * Setup tools for the campaign screen: tracking-link builder, manual
 * campaign-to-UTM mapping and custom (non-Meta) spend upload. `targets` are
 * the UTM combinations seen in the data; `onChanged` reloads the report.
 */
export function UtmTools({ currency, targets, summary, onChanged }: { currency: string; targets: Array<{ value: string; label: string }>; summary: string; onChanged: () => void }) {
    const [mappingData, setMappingData] = useState<CampaignMappingData | null>(null);
    const [mappingForm, setMappingForm] = useState({ externalCampaignId: "", target: "" });
    const [mappingSaving, setMappingSaving] = useState(false);
    const [mappingError, setMappingError] = useState("");
    const [customSpendImporting, setCustomSpendImporting] = useState(false);
    const [customSpendStatus, setCustomSpendStatus] = useState("");
    const [customSpendDraft, setCustomSpendDraft] = useState<ParsedCustomSpendCsv | null>(null);
    const [customSpendPreview, setCustomSpendPreview] = useState<{ filename: string; rows: CustomSpendInputRow[] } | null>(null);
    const [customSpendBatches, setCustomSpendBatches] = useState<CustomSpendBatch[]>([]);
    const [campaignBuilder, setCampaignBuilder] = useState({ baseUrl: "", source: "", medium: "", campaign: "", content: "", term: "" });
    const [campaignUrlStatus, setCampaignUrlStatus] = useState("");
    const loadMappings = useCallback(async () => {
      try {
        const response = await fetch("/api/settings/campaign-mappings");
        const payload = await response.json() as CampaignMappingData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load campaign mappings");
        setMappingData(payload); setMappingError("");
      } catch (reason) { setMappingData(null); setMappingError(reason instanceof Error ? reason.message : "Could not load campaign mappings"); }
    }, []);
    useEffect(() => { const timeout = window.setTimeout(() => void loadMappings(), 0); return () => window.clearTimeout(timeout); }, [loadMappings]);
    const loadCustomSpend = useCallback(async () => { try { const response = await fetch("/api/settings/custom-spend"); if (!response.ok) return; const payload = await response.json() as { batches?: CustomSpendBatch[] }; setCustomSpendBatches(payload.batches ?? []); } catch { setCustomSpendBatches([]); } }, []);
    useEffect(() => { const timeout = window.setTimeout(() => void loadCustomSpend(), 0); return () => window.clearTimeout(timeout); }, [loadCustomSpend]);
    const campaignUrl = buildCampaignUrl(campaignBuilder.baseUrl, campaignBuilder);
    const updateCampaignBuilder = (field: keyof typeof campaignBuilder, value: string) => { setCampaignBuilder((current) => ({ ...current, [field]: value })); setCampaignUrlStatus(""); };
    const copyCampaignUrl = async () => {
      if (!campaignUrl.ok) return;
      try { await navigator.clipboard.writeText(campaignUrl.url); setCampaignUrlStatus("Campaign URL copied"); }
      catch { setCampaignUrlStatus("Copy failed. Select the URL and copy it manually."); }
    };
    const saveMapping = async () => {
      if (!mappingForm.externalCampaignId || !mappingForm.target) return;
      setMappingSaving(true); setMappingError("");
      try {
        const [utmSource, utmMedium, utmCampaign] = JSON.parse(mappingForm.target) as string[];
        const response = await fetch("/api/settings/campaign-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalCampaignId: mappingForm.externalCampaignId, utmSource, utmMedium, utmCampaign }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not save campaign mapping");
        setMappingForm({ externalCampaignId: "", target: "" }); await loadMappings(); onChanged();
      } catch (reason) { setMappingError(reason instanceof Error ? reason.message : "Could not save campaign mapping"); }
      finally { setMappingSaving(false); }
    };
    const deleteMapping = async (id: string) => {
      setMappingSaving(true); setMappingError("");
      try {
        const response = await fetch(`/api/settings/campaign-mappings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || "Could not remove campaign mapping"); }
        await loadMappings(); onChanged();
      } catch (reason) { setMappingError(reason instanceof Error ? reason.message : "Could not remove campaign mapping"); }
      finally { setMappingSaving(false); }
    };
    const prepareCustomSpend = async (file: File) => {
      setCustomSpendStatus("");
      setCustomSpendPreview(null);
      try {
        const draft = parseCustomSpendCsv(await file.text(), file.name);
        setCustomSpendDraft(draft);
        const missing = customSpendColumnFields.filter((field) => field.required && draft.mapping[field.key] < 0);
        setCustomSpendStatus(missing.length ? "Map the required columns, then preview the import." : "Review the detected columns, then preview the import.");
      } catch (reason) {
        setCustomSpendDraft(null);
        setCustomSpendStatus(reason instanceof Error ? reason.message : "Could not read custom spend CSV");
      }
    };
    const updateCustomSpendMapping = (key: CustomSpendColumnKey, index: number) => {
      setCustomSpendDraft((draft) => draft ? { ...draft, mapping: { ...draft.mapping, [key]: index } } : null);
      setCustomSpendPreview(null);
    };
    const previewCustomSpend = () => {
      if (!customSpendDraft) return;
      const result = buildCustomSpendRows(customSpendDraft, customSpendDraft.mapping, currency);
      if (!result.ok) {
        setCustomSpendPreview(null);
        setCustomSpendStatus(result.error);
        return;
      }
      setCustomSpendPreview({ filename: customSpendDraft.filename, rows: result.rows });
      setCustomSpendStatus(`${result.rows.length.toLocaleString()} rows are ready to import.`);
    };
    const importCustomSpend = async () => {
      if (!customSpendPreview) return;
      setCustomSpendImporting(true); setCustomSpendStatus("");
      try {
        const response = await fetch("/api/settings/custom-spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(customSpendPreview) });
        const payload = await response.json() as { error?: string; batch?: { inserted_count: number; updated_count: number } };
        if (!response.ok) throw new Error(payload.error || "Could not import custom spend");
        setCustomSpendStatus(`${payload.batch?.inserted_count ?? 0} new and ${payload.batch?.updated_count ?? 0} updated spend rows imported`);
        setCustomSpendPreview(null); setCustomSpendDraft(null); await loadCustomSpend(); onChanged();
      } catch (reason) { setCustomSpendStatus(reason instanceof Error ? reason.message : "Could not import custom spend"); }
      finally { setCustomSpendImporting(false); }
    };
    const rollbackCustomSpend = async (batchId: string) => {
      setCustomSpendImporting(true); setCustomSpendStatus("");
      try {
        const response = await fetch(`/api/settings/custom-spend?batchId=${encodeURIComponent(batchId)}`, { method: "DELETE" });
        const payload = await response.json() as { error?: string; restoredRows?: number };
        if (!response.ok) throw new Error(payload.error || "Could not roll back this import");
        setCustomSpendStatus(`Import rolled back · ${payload.restoredRows ?? 0} overwritten rows restored`);
        await loadCustomSpend(); onChanged();
      } catch (reason) { setCustomSpendStatus(reason instanceof Error ? reason.message : "Could not roll back this import"); }
      finally { setCustomSpendImporting(false); }
    };
    const latestActiveCustomSpendBatchId = customSpendBatches.find((batch) => !batch.rolled_back_at)?.id ?? null;
  const mappingTargets = targets;
  return <>
        <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CAMPAIGN URL BUILDER</span><h2>Create consistently named tracking links</h2></div><span className="report-note">Values are normalized to lowercase words separated by underscores so future campaign matching stays predictable.</span></div>
      <div className="form-grid"><label className="form-field"><span>Landing-page URL</span><input type="url" value={campaignBuilder.baseUrl} onChange={(event) => updateCampaignBuilder("baseUrl", event.target.value)} placeholder="https://example.com/products/widget"/></label><label className="form-field"><span>Source</span><input value={campaignBuilder.source} onChange={(event) => updateCampaignBuilder("source", event.target.value)} placeholder="meta"/></label><label className="form-field"><span>Medium</span><input value={campaignBuilder.medium} onChange={(event) => updateCampaignBuilder("medium", event.target.value)} placeholder="paid_social"/></label><label className="form-field"><span>Campaign</span><input value={campaignBuilder.campaign} onChange={(event) => updateCampaignBuilder("campaign", event.target.value)} placeholder="summer_sale_uk"/></label><label className="form-field"><span>Content (optional)</span><input value={campaignBuilder.content} onChange={(event) => updateCampaignBuilder("content", event.target.value)} placeholder="carousel_a"/></label><label className="form-field"><span>Term (optional)</span><input value={campaignBuilder.term} onChange={(event) => updateCampaignBuilder("term", event.target.value)} placeholder="running_shoes"/></label></div>
      {campaignUrl.ok ? <div className="connected-account"><span/><div><small>TRACKING URL</small><strong><code>{campaignUrl.url}</code></strong><small>{campaignUrlStatus || "Existing landing-page parameters and fragments are preserved."}</small></div><button className="primary" onClick={() => void copyCampaignUrl()}>Copy URL</button></div> : campaignBuilder.baseUrl || campaignBuilder.source || campaignBuilder.medium || campaignBuilder.campaign ? <div className="connection-notice"><Info/><div><strong>Complete the required fields</strong><span>{campaignUrl.error}</span></div></div> : null}
    </section>
    <section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">CAMPAIGN SPEND MAPPING</span><h2>Connect Meta campaigns to UTM traffic</h2></div><span className="report-note">{summary}</span></div>
      {mappingError ? <div className="connection-notice"><Info/><div><strong>Campaign mapping needs attention</strong><span>{mappingError}</span></div></div> : null}
      {mappingData?.canManage && mappingData.campaigns.length > 0 && mappingTargets.length > 0 ? <div className="filter-row"><select aria-label="Meta campaign" value={mappingForm.externalCampaignId} onChange={(event) => setMappingForm((current) => ({ ...current, externalCampaignId: event.target.value }))}><option value="">Choose Meta campaign</option>{mappingData.campaigns.map((item) => <option key={item.campaign_id} value={item.campaign_id}>{item.campaign_name}</option>)}</select><select aria-label="UTM target" value={mappingForm.target} onChange={(event) => setMappingForm((current) => ({ ...current, target: event.target.value }))}><option value="">Choose UTM source / medium / campaign</option>{mappingTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select><button disabled={mappingSaving || !mappingForm.externalCampaignId || !mappingForm.target} onClick={() => void saveMapping()}>{mappingSaving ? "Saving…" : "Save mapping"}</button></div> : null}
      {mappingData && mappingData.campaigns.length === 0 ? <div className="connection-notice"><Info/><div><strong>Import campaign-level Meta data</strong><span>Reconnect or run the Meta import once after this update, then campaign names will be available to map.</span></div></div> : null}
      {mappingData?.canManage ? <>
        <div className="filter-row">
          <label>Custom spend CSV<input type="file" accept=".csv,text/csv" disabled={customSpendImporting} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void prepareCustomSpend(file); }}/></label>
          <span className="report-note">{customSpendStatus || "Upload a CSV, map its columns, review the preview, then import."}</span>
        </div>
        {customSpendDraft ? <div className="custom-spend-mapper">
          <div className="custom-spend-mapper-head"><div><strong>Map columns</strong><span>{customSpendDraft.filename} · {customSpendDraft.rows.length.toLocaleString()} rows</span></div></div>
          <div className="filter-row">{customSpendColumnFields.map((field) => <label key={field.key}>{field.label}{field.required ? " *" : ""}
            <select aria-label={`Map ${field.label}`} value={customSpendDraft.mapping[field.key]} onChange={(event) => updateCustomSpendMapping(field.key, Number(event.target.value))}>
              <option value={-1}>{field.required ? "Choose column" : "Not imported"}</option>
              {customSpendDraft.headers.map((header, index) => <option key={`${field.key}-${index}`} value={index}>{header}</option>)}
            </select>
          </label>)}</div>
          <div className="table-footer"><span>* Required. Unmapped currency uses {currency}.</span><div className="feature-actions"><button disabled={customSpendImporting} onClick={() => { setCustomSpendDraft(null); setCustomSpendPreview(null); setCustomSpendStatus(""); }}>Cancel</button><button className="primary" disabled={customSpendImporting} onClick={previewCustomSpend}>Preview rows</button></div></div>
        </div> : null}
        {customSpendPreview ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Source</th><th>Medium</th><th>Campaign</th><th>Spend</th><th>Currency</th></tr></thead><tbody>{customSpendPreview.rows.slice(0, 5).map((row, index) => <tr key={`${row.date}-${row.source}-${index}`}><td>{row.date}</td><td>{row.source}</td><td>{row.medium || "(none)"}</td><td>{row.campaign || "(not set)"}</td><td>{row.spend}</td><td>{row.currency}</td></tr>)}</tbody></table><div className="table-footer"><span>Previewing {Math.min(customSpendPreview.rows.length, 5)} of {customSpendPreview.rows.length} rows from {customSpendPreview.filename}</span><div className="feature-actions"><button disabled={customSpendImporting} onClick={() => setCustomSpendPreview(null)}>Edit mapping</button><button className="primary" disabled={customSpendImporting} onClick={() => void importCustomSpend()}>{customSpendImporting ? "Importing…" : "Import rows"}</button></div></div></div> : null}
        {customSpendBatches.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Recent import</th><th>Rows</th><th>Result</th><th>Imported</th><th/></tr></thead><tbody>{customSpendBatches.slice(0, 5).map((batch) => <tr key={batch.id}><td>{batch.original_filename}</td><td>{batch.row_count.toLocaleString()}</td><td>{batch.rolled_back_at ? "Rolled back" : `${batch.inserted_count} new · ${batch.updated_count} updated`}</td><td>{new Date(batch.created_at).toLocaleString("en-GB")}</td><td>{!batch.rolled_back_at && (batch.id === latestActiveCustomSpendBatchId ? <button className="danger-button" disabled={customSpendImporting} onClick={() => void rollbackCustomSpend(batch.id)}>Roll back</button> : <span className="muted">Rollback newer first</span>)}</td></tr>)}</tbody></table></div> : null}
      </> : null}
      {mappingData?.mappings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Platform campaign</th><th>UTM source</th><th>UTM medium</th><th>UTM campaign</th>{mappingData.canManage ? <th>Action</th> : null}</tr></thead><tbody>{mappingData.mappings.map((mapping) => <tr key={mapping.id}><td><strong>{mapping.external_campaign_name}</strong></td><td>{mapping.utm_source}</td><td>{mapping.utm_medium}</td><td>{mapping.utm_campaign}</td>{mappingData.canManage ? <td><button aria-label={`Remove ${mapping.external_campaign_name} mapping`} disabled={mappingSaving} onClick={() => void deleteMapping(mapping.id)}><Trash2/> Remove</button></td> : null}</tr>)}</tbody></table></div> : <div className="table-footer"><span>No campaign mappings yet.</span></div>}
    </section>
  </>;
}
