"use client";

import { useEffect, useState } from "react";
import { Skeleton, TableRowSkeleton } from "@/components/ui/skeleton";
import { estimatedTransactionFee } from "@/lib/analytics/transaction-fees";
import { shopifyThirdPartyRate } from "@/lib/analytics/external-payment-fees";
import { invalidateCachedJson } from "@/lib/analytics/client-response-cache";
import { CircleDollarSign, Plus, WalletCards, X, Trash2 } from "lucide-react";

type OperatingCost = { id: string; name: string; category: string; amount: string; currency: string; cadence: string; allocation_basis: string; effective_from: string; effective_to: string | null; notes: string | null };

type PaymentFeeRule = { id: string; gateway: string; percentage_rate: string; fixed_fee: string; tax_rate: string; minimum_fee: string; currency: string; effective_from: string; effective_to: string | null };

type PaymentFeeSettings = { shopify_plan: string | null; plan_override: string | null; default_percentage_rate: string; default_fixed_fee: string; surcharge_rate_override: string | null; gateway_synced_at: string | null };

export function Expenses() {
  const [costs, setCosts] = useState<OperatingCost[]>([]);
  const [paymentRules, setPaymentRules] = useState<PaymentFeeRule[]>([]);
  const [paymentSettings, setPaymentSettings] = useState<PaymentFeeSettings | null>(null);
  const [paymentGateways, setPaymentGateways] = useState<string[]>([]);
  const [estimateForm, setEstimateForm] = useState({ planOverride: "", defaultPercentageRate: "", defaultFixedFee: "", surchargeRateOverride: "" });
  const [loadedEstimateForm, setLoadedEstimateForm] = useState(estimateForm);
  const [estimateStatus, setEstimateStatus] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [canEdit, setCanEdit] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddPaymentRule, setShowAddPaymentRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", category: "software", amount: "", cadence: "monthly", allocationBasis: "fixed", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });
  const [paymentForm, setPaymentForm] = useState({ gateway: "", percentageRate: "", fixedFee: "", taxRate: "0", minimumFee: "0", effectiveFrom: "2020-01-01", effectiveTo: "" });
  const load = () => Promise.all([
    fetch("/api/costs/operating").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load operating costs"); return payload; }),
    fetch("/api/costs/payment-fees").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load payment fee rules"); return payload; }),
  ]).then(([costPayload, feePayload]) => {
    setError("");
    setCosts(costPayload.costs ?? []);
    setPaymentRules(feePayload.rules ?? []);
    setPaymentSettings(feePayload.settings ?? null);
    setPaymentGateways(feePayload.gateways ?? []);
    const loadedEstimate = { planOverride: feePayload.settings?.plan_override ?? "", defaultPercentageRate: String(feePayload.settings?.default_percentage_rate ?? 2),
      defaultFixedFee: String(feePayload.settings?.default_fixed_fee ?? (feePayload.currency === "GBP" ? 0.23 : 0.25)),
      surchargeRateOverride: feePayload.settings?.surcharge_rate_override == null ? "" : String(feePayload.settings.surcharge_rate_override) };
    setEstimateForm(loadedEstimate);
    setLoadedEstimateForm(loadedEstimate);
    setCurrency(costPayload.currency ?? feePayload.currency ?? "GBP");
    setCanEdit(Boolean(costPayload.canEdit && feePayload.canEdit));
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load expenses")).finally(() => setInitialLoading(false));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/operating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, effectiveTo: form.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save operating cost");
      setShowAdd(false); setForm({ ...form, name: "", amount: "", effectiveTo: "", notes: "" }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save operating cost"); } finally { setSaving(false); }
  };
  const savePaymentRule = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/payment-fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...paymentForm, effectiveTo: paymentForm.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save payment fee rule");
      setShowAddPaymentRule(false);
      setPaymentForm({ ...paymentForm, gateway: "", percentageRate: estimateForm.defaultPercentageRate, fixedFee: estimateForm.defaultFixedFee, taxRate: "0", minimumFee: "0", effectiveTo: "" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save payment fee rule"); } finally { setSaving(false); }
  };
  const deletePaymentRule = async (rule: PaymentFeeRule) => {
    if (!window.confirm(`Delete the ${rule.gateway} rule effective ${rule.effective_from}?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/costs/payment-fees?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete payment fee rule");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete payment fee rule"); }
  };
  const saveEstimateSettings = async () => {
    setSaving(true); setError(""); setEstimateStatus("");
    try {
      const response = await fetch("/api/costs/payment-fees", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(estimateForm) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save payment estimate settings");
      invalidateCachedJson("/api/analytics/pnl");
      await load();
      setEstimateStatus("Saved");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save payment estimate settings"); } finally { setSaving(false); }
  };
  const updateEstimateForm = (changes: Partial<typeof estimateForm>) => { setEstimateStatus(""); setEstimateForm((current) => ({ ...current, ...changes })); };
  const openAddPaymentRule = (gateway = "") => {
    setPaymentForm((current) => ({ ...current, gateway: gateway || current.gateway, percentageRate: estimateForm.defaultPercentageRate || current.percentageRate, fixedFee: estimateForm.defaultFixedFee || current.fixedFee }));
    setShowAddPaymentRule(true);
  };
  const estimateDirty = JSON.stringify(estimateForm) !== JSON.stringify(loadedEstimateForm);
  const feeExampleGateway = paymentGateways[0] ?? "a processor";
  const feeExampleRate = Number(estimateForm.defaultPercentageRate);
  const feeExampleFixed = Number(estimateForm.defaultFixedFee);
  const feeExamplePlan = estimateForm.planOverride || paymentSettings?.shopify_plan || "Basic";
  const feeExampleSurchargeRate = estimateForm.surchargeRateOverride !== "" ? Number(estimateForm.surchargeRateOverride) : shopifyThirdPartyRate(feeExamplePlan);
  const feeExampleAmount = 50;
  const feeExampleProcessorFee = Number.isFinite(feeExampleRate) && Number.isFinite(feeExampleFixed)
    ? estimatedTransactionFee(feeExampleAmount, { percentageRate: feeExampleRate, fixedFee: feeExampleFixed, taxRate: 0, minimumFee: 0 })
    : null;
  const feeExampleSurcharge = feeExampleSurchargeRate === null ? 0 : feeExampleAmount * feeExampleSurchargeRate / 100;
  const feeExampleTotal = feeExampleProcessorFee === null ? null : feeExampleProcessorFee + feeExampleSurcharge;
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
  return <>
    <section className="cost-toolbar">
      <div><span className="eyebrow">COST INPUTS</span><h2>Expenses and payment fees</h2><p>Use effective dates so the P&amp;L applies each cost and gateway rate to the right orders.</p></div>
      <div className="feature-actions"><button className="primary" disabled={!canEdit} onClick={() => setShowAdd(true)}><Plus/> Add expense</button><button disabled={!canEdit} onClick={() => openAddPaymentRule()}><Plus/> Add processor rate</button></div>
    </section>
    {error && <div className="connection-error cost-error">{error}</div>}
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">COST SCHEDULE</span><h2>Operating expenses</h2></div></div>
      {initialLoading ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Category</th><th>Amount</th><th>Cadence</th><th>Allocation</th><th>Effective from</th><th>Effective to</th></tr></thead><tbody>{Array.from({ length: 3 }, (_, index) => <TableRowSkeleton key={index} columns={7}/>)}</tbody></table></div> : costs.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Category</th><th>Amount</th><th>Cadence</th><th>Allocation</th><th>Effective from</th><th>Effective to</th></tr></thead><tbody>{costs.map((cost) => <tr key={cost.id}><td><strong>{cost.name}</strong>{cost.notes && <small>{cost.notes}</small>}</td><td>{cost.category}</td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>{cost.cadence.replace("_", " ")}</td><td>{cost.allocation_basis}</td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><WalletCards/><strong>No operating costs yet</strong><span>Add a recurring or one-off cost to include it in future net-profit calculations.</span></div>}
    </section>
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">PAYMENT ESTIMATES</span><h2>External processor defaults</h2><p>Successful external payments use these estimates until you set a rate for that processor. The fixed fee applies once per payment, in {currency}. Shopify&apos;s third-party surcharge is estimated separately from the store plan.</p></div></div>
      {initialLoading ? <div className="panel-body cost-form-grid">{Array.from({ length: 4 }, (_, index) => <label className="form-field" key={index}><Skeleton style={{ width: "40%", height: 10 }}/><Skeleton style={{ width: "100%", height: 42, marginTop: 7 }}/></label>)}</div> : <div className="panel-body"><div className="cost-form-grid"><label className="form-field"><span>Shopify plan</span><select value={estimateForm.planOverride} onChange={(event) => updateEstimateForm({ planOverride: event.target.value })}><option value="">{paymentSettings?.shopify_plan ? `Automatic (${paymentSettings.shopify_plan}, detected)` : "Automatic (Basic until detected)"}</option>{["Basic", "Grow", "Advanced", "Plus"].map((plan) => <option key={plan} value={plan}>{plan}</option>)}</select></label><label className="form-field"><span>Default processor rate (%)</span><input inputMode="decimal" value={estimateForm.defaultPercentageRate} onChange={(event) => updateEstimateForm({ defaultPercentageRate: event.target.value })}/></label><label className="form-field"><span>Default fixed fee per payment ({currency})</span><input inputMode="decimal" value={estimateForm.defaultFixedFee} onChange={(event) => updateEstimateForm({ defaultFixedFee: event.target.value })}/></label><label className="form-field"><span>Shopify surcharge override (%) <small>Optional</small></span><input inputMode="decimal" value={estimateForm.surchargeRateOverride} onChange={(event) => updateEstimateForm({ surchargeRateOverride: event.target.value })} placeholder="Use plan rate"/></label></div>
      {feeExampleTotal !== null && <div className="fee-example">A {formatter.format(feeExampleAmount)} payment through <strong>{feeExampleGateway}</strong> ≈ <strong>{formatter.format(feeExampleTotal)}</strong> in fees ({formatter.format(feeExampleProcessorFee ?? 0)} processor{feeExampleSurcharge > 0 ? ` + ${formatter.format(feeExampleSurcharge)} Shopify surcharge` : ""}).</div>}
      <div className="feature-actions">{estimateStatus && !saving && <span className="save-status">{estimateStatus}</span>}<button className="primary" disabled={!canEdit || saving || !estimateDirty} onClick={() => void saveEstimateSettings()}>{saving ? "Saving…" : "Save estimate settings"}</button></div></div>}
    </section>
    <section className="panel report-panel">
      <div className="panel-head"><div><span className="eyebrow">TRANSACTION COSTS</span><h2>Processor-specific rates</h2><p>Override the default for PayPal, Klarna or another gateway. These are estimates; actual Shopify Payments fees stay in their own P&amp;L row.</p></div></div>
      {paymentGateways.length > 0 && <div className="gateway-chip-list">{paymentGateways.map((gateway) => {
        const configured = paymentRules.some((rule) => rule.gateway.toLowerCase() === gateway.toLowerCase());
        return <span className="gateway-chip" key={gateway}>{gateway}{configured && <small>Configured</small>}<button type="button" disabled={!canEdit} onClick={() => openAddPaymentRule(gateway)}>{configured ? "Update rate" : "Set rate"}</button></span>;
      })}</div>}
      {paymentRules.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Gateway</th><th>Rate</th><th>Fixed fee</th><th>Tax</th><th>Minimum</th><th>Effective from</th><th>Effective to</th><th></th></tr></thead><tbody>{paymentRules.map((rule) => <tr key={rule.id}><td><strong>{rule.gateway}</strong><small>{rule.currency}</small></td><td>{Number(rule.percentage_rate).toLocaleString("en-GB")}%</td><td>{formatter.format(Number(rule.fixed_fee))}</td><td>{Number(rule.tax_rate).toLocaleString("en-GB")}%</td><td>{formatter.format(Number(rule.minimum_fee))}</td><td>{rule.effective_from}</td><td>{rule.effective_to || "Ongoing"}</td><td>{canEdit && <button className="icon-button" aria-label={`Delete ${rule.gateway} payment fee rule`} onClick={() => void deletePaymentRule(rule)}><Trash2/></button>}</td></tr>)}</tbody></table></div> : <div className="cost-empty"><CircleDollarSign/><strong>Using store defaults</strong><span>Add a processor-specific rate when its contract differs from the default.</span></div>}
    </section>
    {showAdd && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowAdd(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">OPERATING COST</span><h2>Add expense</h2></div></div><label className="form-field"><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Shopify subscription"/></label><div className="cost-form-grid"><label className="form-field"><span>Category</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{["software", "agency", "payroll", "warehouse", "rent", "creative", "fulfilment", "handling", "pick_pack", "duties", "other"].map((category) => <option key={category} value={category}>{category.replace("_", " ")}</option>)}</select></label><label className="form-field"><span>{form.allocationBasis === "revenue" ? "Revenue rate (%)" : "Amount"}</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder={form.allocationBasis === "revenue" ? "e.g. 2.5" : "0.00"}/></label><label className="form-field"><span>Cadence</span><select value={form.cadence} onChange={(event) => setForm({ ...form, cadence: event.target.value })}>{["one_off", "daily", "weekly", "monthly", "annual"].map((cadence) => <option key={cadence} value={cadence}>{cadence.replace("_", " ")}</option>)}</select></label><label className="form-field"><span>Allocation</span><select value={form.allocationBasis} onChange={(event) => setForm({ ...form, allocationBasis: event.target.value })}>{["fixed", "orders", "units", "revenue"].map((basis) => <option key={basis} value={basis}>{basis}</option>)}</select></label><label className="form-field"><span>Effective from</span><input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}/></label></div><label className="form-field"><span>Notes <small>Optional</small></span><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What this cost covers"/></label><p className="modal-intro">{form.allocationBasis === "fixed" ? "Fixed costs are spread across their active date range." : form.allocationBasis === "revenue" ? "Revenue allocation uses the entered percentage of net product sales during the active period." : `This uses the entered amount for every ${form.allocationBasis === "orders" ? "order" : "unit"} during the active period.`}</p><div className="modal-actions"><button onClick={() => setShowAdd(false)}>Cancel</button><button className="primary" disabled={!form.name || !form.amount || saving} onClick={save}>{saving ? "Saving…" : "Save expense"}</button></div></section></div>}
    {showAddPaymentRule && <div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={() => setShowAddPaymentRule(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><CircleDollarSign/></span><div><span className="eyebrow">PAYMENT FEE</span><h2>Add processor rate</h2></div></div><label className="form-field"><span>Shopify gateway name</span><input list="payment-gateway-options" value={paymentForm.gateway} onChange={(event) => setPaymentForm({ ...paymentForm, gateway: event.target.value })} placeholder="Choose a detected gateway or type its name"/><datalist id="payment-gateway-options">{paymentGateways.map((gateway) => <option key={gateway} value={gateway}/>)}</datalist></label><div className="cost-form-grid"><label className="form-field"><span>Percentage rate</span><input inputMode="decimal" value={paymentForm.percentageRate} onChange={(event) => setPaymentForm({ ...paymentForm, percentageRate: event.target.value })} placeholder="e.g. 2"/></label><label className="form-field"><span>Fixed fee ({currency}) per payment</span><input inputMode="decimal" value={paymentForm.fixedFee} onChange={(event) => setPaymentForm({ ...paymentForm, fixedFee: event.target.value })} placeholder="e.g. 0.23"/></label><label className="form-field"><span>Tax rate</span><input inputMode="decimal" value={paymentForm.taxRate} onChange={(event) => setPaymentForm({ ...paymentForm, taxRate: event.target.value })} placeholder="e.g. 20"/></label><label className="form-field"><span>Minimum fee ({currency})</span><input inputMode="decimal" value={paymentForm.minimumFee} onChange={(event) => setPaymentForm({ ...paymentForm, minimumFee: event.target.value })} placeholder="0.00"/></label><label className="form-field"><span>Effective from</span><input type="date" value={paymentForm.effectiveFrom} onChange={(event) => setPaymentForm({ ...paymentForm, effectiveFrom: event.target.value })}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={paymentForm.effectiveTo} onChange={(event) => setPaymentForm({ ...paymentForm, effectiveTo: event.target.value })}/></label></div><p className="modal-intro">The estimate uses payment value × rate plus the fixed fee for each successful payment. Set both values to zero to exclude a gateway from processor estimates.</p><div className="modal-actions"><button onClick={() => setShowAddPaymentRule(false)}>Cancel</button><button className="primary" disabled={!paymentForm.gateway || saving} onClick={savePaymentRule}>{saving ? "Saving…" : "Save rate"}</button></div></section></div>}
  </>;
}
