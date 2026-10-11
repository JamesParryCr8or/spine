"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormGrid, SelectInput, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { useToast } from "@/components/ui/toast";
import { estimatedTransactionFee } from "@/lib/analytics/transaction-fees";
import { shopifyThirdPartyRate } from "@/lib/analytics/external-payment-fees";
import { invalidateCachedJson } from "@/lib/analytics/client-response-cache";
import { CircleDollarSign, Plus, WalletCards, Trash2 } from "lucide-react";

type OperatingCost = { id: string; name: string; category: string; amount: string; currency: string; cadence: string; allocation_basis: string; effective_from: string; effective_to: string | null; notes: string | null };

type PaymentFeeRule = { id: string; gateway: string; percentage_rate: string; fixed_fee: string; tax_rate: string; minimum_fee: string; currency: string; effective_from: string; effective_to: string | null };

type PaymentFeeSettings = { shopify_plan: string | null; plan_override: string | null; default_percentage_rate: string; default_fixed_fee: string; surcharge_rate_override: string | null; gateway_synced_at: string | null };

export function Expenses() {
  const { toast } = useToast();
  const [costs, setCosts] = useState<OperatingCost[]>([]);
  const [paymentRules, setPaymentRules] = useState<PaymentFeeRule[]>([]);
  const [paymentSettings, setPaymentSettings] = useState<PaymentFeeSettings | null>(null);
  const [paymentGateways, setPaymentGateways] = useState<string[]>([]);
  const [estimateForm, setEstimateForm] = useState({ planOverride: "", defaultPercentageRate: "", defaultFixedFee: "", surchargeRateOverride: "" });
  const [loadedEstimateForm, setLoadedEstimateForm] = useState(estimateForm);
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
      toast({ title: "Expense added", tone: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save operating cost"); } finally { setSaving(false); }
  };
  const savePaymentRule = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/payment-fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...paymentForm, effectiveTo: paymentForm.effectiveTo || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save payment fee rule");
      setShowAddPaymentRule(false);
      toast({ title: "Processor rate saved", tone: "success" });
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
      toast({ title: "Rate deleted", tone: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete payment fee rule"); }
  };
  const saveEstimateSettings = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/costs/payment-fees", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(estimateForm) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save payment estimate settings");
      invalidateCachedJson("/api/analytics/pnl");
      await load();
      toast({ title: "Estimate settings saved", tone: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save payment estimate settings"); } finally { setSaving(false); }
  };
  const updateEstimateForm = (changes: Partial<typeof estimateForm>) => { setEstimateForm((current) => ({ ...current, ...changes })); };
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
  const columnsForCosts: Column<OperatingCost>[] = [
    { key: "name", header: "Name", sortValue: (cost) => cost.name, render: (cost) => <><strong className="font-semibold">{cost.name}</strong>{cost.notes && <span className="block text-ds-muted">{cost.notes}</span>}</> },
    { key: "category", header: "Category", sortValue: (cost) => cost.category, render: (cost) => <span className="capitalize">{cost.category.replace("_", " ")}</span> },
    { key: "amount", header: "Amount", numeric: true, sortValue: (cost) => Number(cost.amount), render: (cost) => <strong className="font-semibold">{cost.allocation_basis === "revenue" ? `${Number(cost.amount).toLocaleString("en-GB")}%` : formatter.format(Number(cost.amount))}</strong> },
    { key: "cadence", header: "Cadence", sortValue: (cost) => cost.cadence, render: (cost) => <span className="capitalize">{cost.cadence.replace("_", " ")}</span> },
    { key: "allocation", header: "Allocation", sortValue: (cost) => cost.allocation_basis, render: (cost) => <span className="capitalize">{cost.allocation_basis}</span> },
    { key: "from", header: "Effective from", sortValue: (cost) => cost.effective_from },
    { key: "to", header: "Effective to", sortValue: (cost) => cost.effective_to ?? "9999-12-31", render: (cost) => cost.effective_to || "Ongoing", csv: (cost) => cost.effective_to ?? "Ongoing" },
  ];
  const columnsForRules: Column<PaymentFeeRule>[] = [
    { key: "gateway", header: "Gateway", sortValue: (rule) => rule.gateway, render: (rule) => <><strong className="font-semibold">{rule.gateway}</strong><span className="block text-ds-muted">{rule.currency}</span></> },
    { key: "rate", header: "Rate", numeric: true, sortValue: (rule) => Number(rule.percentage_rate), render: (rule) => `${Number(rule.percentage_rate).toLocaleString("en-GB")}%` },
    { key: "fixed", header: "Fixed fee", numeric: true, sortValue: (rule) => Number(rule.fixed_fee), render: (rule) => formatter.format(Number(rule.fixed_fee)) },
    { key: "tax", header: "Tax", numeric: true, sortValue: (rule) => Number(rule.tax_rate), render: (rule) => `${Number(rule.tax_rate).toLocaleString("en-GB")}%` },
    { key: "minimum", header: "Minimum", numeric: true, sortValue: (rule) => Number(rule.minimum_fee), render: (rule) => formatter.format(Number(rule.minimum_fee)) },
    { key: "from", header: "Effective from", sortValue: (rule) => rule.effective_from },
    { key: "to", header: "Effective to", sortValue: (rule) => rule.effective_to ?? "9999-12-31", render: (rule) => rule.effective_to || "Ongoing", csv: (rule) => rule.effective_to ?? "Ongoing" },
    { key: "actions", header: "", render: (rule) => canEdit ? <Button variant="ghost" size="icon" aria-label={`Delete ${rule.gateway} payment fee rule`} onClick={() => void deletePaymentRule(rule)}><Trash2/></Button> : null },
  ];
  const costCategories = ["software", "agency", "payroll", "warehouse", "rent", "creative", "fulfilment", "handling", "pick_pack", "duties", "other"];
  const allocationHint = form.allocationBasis === "fixed" ? "Fixed costs are spread across their active date range." : form.allocationBasis === "revenue" ? "Revenue allocation uses the entered percentage of net product sales during the active period." : `This uses the entered amount for every ${form.allocationBasis === "orders" ? "order" : "unit"} during the active period.`;
  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="block text-ds-label uppercase text-ds-muted">Cost inputs</span>
        <h2 className="mt-1 text-ds-display text-ds-ink">Expenses and payment fees</h2>
        <p className="mt-1 max-w-[70ch] text-ds-small text-ds-muted">Use effective dates so the P&amp;L applies each cost and gateway rate to the right orders.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="md" disabled={!canEdit} onClick={() => setShowAdd(true)}><Plus/> Add expense</Button>
        <Button variant="quiet" size="md" disabled={!canEdit} onClick={() => openAddPaymentRule()}><Plus/> Add processor rate</Button>
      </div>
    </div>
    {error && <PanelState status="error" title="That did not work" message={error}/>}

    <Panel eyebrow="Cost schedule" title="Operating expenses" flush>
      <DataTable caption="Operating expenses" columns={columnsForCosts} rows={costs} rowKey={(cost) => cost.id} loading={initialLoading} exportName="operating-expenses.csv"
        empty={<EmptyState icon={<WalletCards/>} title="No operating costs yet" description="Add a recurring or one-off cost to include it in future net-profit calculations." action={canEdit ? <Button variant="primary" size="md" onClick={() => setShowAdd(true)}><Plus/> Add expense</Button> : undefined}/>}/>
    </Panel>

    <Panel eyebrow="Payment estimates" title="External processor defaults" description={<>Successful external payments use these estimates until you set a rate for that processor. The fixed fee applies once per payment, in {currency}. Shopify&apos;s third-party surcharge is estimated separately from the store plan.</>}>
      {initialLoading ? <FormGrid>{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex flex-col gap-2"><Skeleton style={{ width: "40%", height: 12 }}/><Skeleton style={{ width: "100%", height: 40 }}/></div>)}</FormGrid> : <>
        <FormGrid>
          <FormField label="Shopify plan"><SelectInput value={estimateForm.planOverride} onChange={(event) => updateEstimateForm({ planOverride: event.target.value })}><option value="">{paymentSettings?.shopify_plan ? `Automatic (${paymentSettings.shopify_plan}, detected)` : "Automatic (Basic until detected)"}</option>{["Basic", "Grow", "Advanced", "Plus"].map((plan) => <option key={plan} value={plan}>{plan}</option>)}</SelectInput></FormField>
          <FormField label="Default processor rate (%)"><TextInput inputMode="decimal" value={estimateForm.defaultPercentageRate} onChange={(event) => updateEstimateForm({ defaultPercentageRate: event.target.value })}/></FormField>
          <FormField label={`Default fixed fee per payment (${currency})`}><TextInput inputMode="decimal" value={estimateForm.defaultFixedFee} onChange={(event) => updateEstimateForm({ defaultFixedFee: event.target.value })}/></FormField>
          <FormField label="Shopify surcharge override (%)" optional><TextInput inputMode="decimal" value={estimateForm.surchargeRateOverride} onChange={(event) => updateEstimateForm({ surchargeRateOverride: event.target.value })} placeholder="Use the plan rate"/></FormField>
        </FormGrid>
        {feeExampleTotal !== null && <div className="mt-4 rounded-ds-sm border border-ds-line bg-ds-canvas px-4 py-3 text-ds-small text-ds-ink">A {formatter.format(feeExampleAmount)} payment through <strong>{feeExampleGateway}</strong> ≈ <strong>{formatter.format(feeExampleTotal)}</strong> in fees ({formatter.format(feeExampleProcessorFee ?? 0)} processor{feeExampleSurcharge > 0 ? ` + ${formatter.format(feeExampleSurcharge)} Shopify surcharge` : ""}).</div>}
        <div className="mt-4 flex justify-end"><Button variant="primary" size="md" loading={saving} disabled={!canEdit || !estimateDirty} onClick={() => void saveEstimateSettings()}>Save estimate settings</Button></div>
      </>}
    </Panel>

    <Panel eyebrow="Transaction costs" title="Processor-specific rates" description="Override the default for PayPal, Klarna or another gateway. These are estimates; actual Shopify Payments fees stay in their own P&L row." flush={paymentRules.length > 0}>
      {paymentGateways.length > 0 && <div className={paymentRules.length > 0 ? "flex flex-wrap gap-2 px-5 pb-4" : "mb-4 flex flex-wrap gap-2"}>{paymentGateways.map((gateway) => {
        const configured = paymentRules.some((rule) => rule.gateway.toLowerCase() === gateway.toLowerCase());
        return <span key={gateway} className="inline-flex items-center gap-2 rounded-full border border-ds-line-strong bg-ds-canvas py-1 pl-3 pr-1 text-ds-small font-medium text-ds-ink">{gateway}{configured && <span className="text-ds-positive">Configured</span>}<Button variant="soft" size="sm" className="h-7 rounded-full" disabled={!canEdit} onClick={() => openAddPaymentRule(gateway)}>{configured ? "Update rate" : "Set rate"}</Button></span>;
      })}</div>}
      <DataTable caption="Processor-specific payment fee rates" columns={columnsForRules} rows={paymentRules} rowKey={(rule) => rule.id} exportName="payment-fee-rates.csv"
        empty={<EmptyState icon={<CircleDollarSign/>} title="Using store defaults" description="Add a processor-specific rate when its contract differs from the default."/>}/>
    </Panel>

    <Modal open={showAdd} onClose={() => setShowAdd(false)} eyebrow="Operating cost" title="Add expense"
      footer={<><Button variant="quiet" size="md" onClick={() => setShowAdd(false)}>Cancel</Button><Button variant="primary" size="md" loading={saving} disabled={!form.name || !form.amount} onClick={save}>Save expense</Button></>}>
      <div className="flex flex-col gap-4">
        <FormField label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Shopify subscription"/></FormField>
        <FormGrid>
          <FormField label="Category"><SelectInput value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{costCategories.map((category) => <option key={category} value={category}>{category.replace("_", " ")}</option>)}</SelectInput></FormField>
          <FormField label={form.allocationBasis === "revenue" ? "Revenue rate (%)" : "Amount"}><TextInput inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder={form.allocationBasis === "revenue" ? "e.g. 2.5" : "0.00"}/></FormField>
          <FormField label="Cadence"><SelectInput value={form.cadence} onChange={(event) => setForm({ ...form, cadence: event.target.value })}>{["one_off", "daily", "weekly", "monthly", "annual"].map((cadence) => <option key={cadence} value={cadence}>{cadence.replace("_", " ")}</option>)}</SelectInput></FormField>
          <FormField label="Allocation"><SelectInput value={form.allocationBasis} onChange={(event) => setForm({ ...form, allocationBasis: event.target.value })}>{["fixed", "orders", "units", "revenue"].map((basis) => <option key={basis} value={basis}>{basis}</option>)}</SelectInput></FormField>
          <FormField label="Effective from"><TextInput type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}/></FormField>
          <FormField label="Effective to" optional><TextInput type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}/></FormField>
        </FormGrid>
        <FormField label="Notes" optional><TextInput value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What this cost covers"/></FormField>
        <p className="text-ds-small text-ds-muted">{allocationHint}</p>
      </div>
    </Modal>

    <Modal open={showAddPaymentRule} onClose={() => setShowAddPaymentRule(false)} eyebrow="Payment fee" title="Add processor rate"
      footer={<><Button variant="quiet" size="md" onClick={() => setShowAddPaymentRule(false)}>Cancel</Button><Button variant="primary" size="md" loading={saving} disabled={!paymentForm.gateway} onClick={savePaymentRule}>Save rate</Button></>}>
      <div className="flex flex-col gap-4">
        <FormField label="Shopify gateway name"><TextInput list="payment-gateway-options" value={paymentForm.gateway} onChange={(event) => setPaymentForm({ ...paymentForm, gateway: event.target.value })} placeholder="Choose a detected gateway or type its name"/><datalist id="payment-gateway-options">{paymentGateways.map((gateway) => <option key={gateway} value={gateway}/>)}</datalist></FormField>
        <FormGrid>
          <FormField label="Percentage rate"><TextInput inputMode="decimal" value={paymentForm.percentageRate} onChange={(event) => setPaymentForm({ ...paymentForm, percentageRate: event.target.value })} placeholder="e.g. 2"/></FormField>
          <FormField label={`Fixed fee (${currency}) per payment`}><TextInput inputMode="decimal" value={paymentForm.fixedFee} onChange={(event) => setPaymentForm({ ...paymentForm, fixedFee: event.target.value })} placeholder="e.g. 0.23"/></FormField>
          <FormField label="Tax rate"><TextInput inputMode="decimal" value={paymentForm.taxRate} onChange={(event) => setPaymentForm({ ...paymentForm, taxRate: event.target.value })} placeholder="e.g. 20"/></FormField>
          <FormField label={`Minimum fee (${currency})`}><TextInput inputMode="decimal" value={paymentForm.minimumFee} onChange={(event) => setPaymentForm({ ...paymentForm, minimumFee: event.target.value })} placeholder="0.00"/></FormField>
          <FormField label="Effective from"><TextInput type="date" value={paymentForm.effectiveFrom} onChange={(event) => setPaymentForm({ ...paymentForm, effectiveFrom: event.target.value })}/></FormField>
          <FormField label="Effective to" optional><TextInput type="date" value={paymentForm.effectiveTo} onChange={(event) => setPaymentForm({ ...paymentForm, effectiveTo: event.target.value })}/></FormField>
        </FormGrid>
        <p className="text-ds-small text-ds-muted">The estimate uses payment value × rate plus the fixed fee for each successful payment. Set both values to zero to exclude a gateway from processor estimates.</p>
      </div>
    </Modal>
  </>;
}
