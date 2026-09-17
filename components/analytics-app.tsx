"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown,
  CircleDollarSign, Database, Download, Eye, EyeOff, ExternalLink, FileBarChart, Info, KeyRound, LayoutDashboard,
  LogOut, Megaphone, Menu, Package, Plus, RefreshCw, Search, Settings,
  ShoppingBag, Sparkles, Table2, TrendingUp, Upload, Users, WalletCards, X,
} from "lucide-react";

type View = "Overview" | "Profit & Loss" | "UTM Analysis" | "Products" | "Customers" | "Costs" | "Reports" | "Connections";

const nav: { label: View; icon: typeof LayoutDashboard; section?: string }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Profit & Loss", icon: FileBarChart, section: "REPORTING" },
  { label: "UTM Analysis", icon: Megaphone },
  { label: "Products", icon: Package },
  { label: "Customers", icon: Users },
  { label: "Costs", icon: WalletCards, section: "DATA" },
  { label: "Reports", icon: Table2 },
  { label: "Connections", icon: Database },
];

const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
const revenue = [68, 79, 72, 91, 83, 100];
const profit = [42, 48, 45, 57, 51, 66];
const spend = [16, 20, 18, 24, 23, 29];

const demoMetrics = [
  { label: "Net sales", value: "£258,592", delta: "+12.4%", positive: true, hint: "vs previous period" },
  { label: "Gross profit", value: "£144,812", delta: "+9.8%", positive: true, hint: "56.0% margin" },
  { label: "Marketing spend", value: "£27,911", delta: "+4.1%", positive: false, hint: "10.8% of sales" },
  { label: "Net profit", value: "£92,917", delta: "+18.2%", positive: true, hint: "35.9% margin" },
];

const channels = [
  { name: "Meta Ads", spend: "£12,480", revenue: "£91,240", roas: "7.3x", share: 79, color: "#7357ff" },
  { name: "Google Ads", spend: "£8,320", revenue: "£58,730", roas: "7.1x", share: 62, color: "#18b981" },
  { name: "Klaviyo", spend: "£1,240", revenue: "£38,910", roas: "31.4x", share: 43, color: "#ff9f43" },
  { name: "Organic", spend: "—", revenue: "£44,206", roas: "—", share: 48, color: "#37a3ff" },
];

const utms = [
  ["facebook", "paid_social", "summer_scaling", "£64,820", "92", "£704", "6.8x"],
  ["google", "cpc", "brand_uk", "£41,340", "71", "£582", "9.2x"],
  ["klaviyo", "email", "product_launch", "£27,850", "43", "£648", "24.1x"],
  ["instagram", "organic", "bio_link", "£18,620", "29", "£642", "—"],
  ["(direct)", "(none)", "—", "£51,420", "84", "£612", "—"],
];

function Trend({ positive = true, children }: { positive?: boolean; children: React.ReactNode }) {
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <span className={positive ? "trend up" : "trend down"}><Icon />{children}</span>;
}

type OverviewData = {
  hasData: boolean;
  currency: string;
  range: { start: string; end: string };
  metrics: { grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number; averageOrderValue: number };
  months: Array<{ key: string; label: string; grossSales: number; discounts: number; netSales: number; shippingRevenue: number; orders: number }>;
};

function Overview() {
  const [liveData, setLiveData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/overview")
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: OverviewData | null) => setLiveData(payload))
      .catch(() => setLiveData(null))
      .finally(() => setLoading(false));
  }, []);

  const hasLiveData = Boolean(liveData?.hasData);
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: liveData?.currency || "GBP", maximumFractionDigits: 0 });
  const liveMetrics = liveData ? [
    { label: "Net sales", value: formatter.format(liveData.metrics.netSales), delta: "Live Shopify data", positive: true, hint: `${liveData.metrics.orders.toLocaleString()} orders` },
    { label: "Gross sales", value: formatter.format(liveData.metrics.grossSales), delta: "Before discounts", positive: true, hint: `${formatter.format(liveData.metrics.discounts)} discounts` },
    { label: "Shipping revenue", value: formatter.format(liveData.metrics.shippingRevenue), delta: "Shopify orders", positive: true, hint: "Excludes tax and duties" },
    { label: "Average order value", value: formatter.format(liveData.metrics.averageOrderValue), delta: "Net product sales", positive: true, hint: `${liveData.metrics.orders.toLocaleString()} completed orders` },
  ] : demoMetrics;
  const chartMonths = hasLiveData ? liveData!.months.map((month) => month.label) : months;
  const chartRevenue = hasLiveData ? liveData!.months.map((month) => month.netSales) : revenue;
  const chartProfit = hasLiveData ? liveData!.months.map((month) => month.grossSales) : profit;
  const chartSpend = hasLiveData ? liveData!.months.map((month) => month.shippingRevenue) : spend;
  const chartMaximum = Math.max(...chartRevenue, ...chartProfit, ...chartSpend, 1);

  return <>
    {loading ? <div className="data-loading">Loading your Shopify summary…</div> : !hasLiveData && liveData ? <div className="connection-notice"><Info/><div><strong>Connect Shopify to start your live dashboard</strong><span>The figures below are a preview. Your own sales and orders will appear after the first sync.</span></div></div> : null}
    <section className="metric-grid">{liveMetrics.map((metric) => <article className="metric-card" key={metric.label}>
      <div className="metric-head"><span>{metric.label}</span><CircleDollarSign /></div>
      <strong>{metric.value}</strong>
      <div className="metric-foot"><Trend positive={metric.positive}>{metric.delta}</Trend><span>{metric.hint}</span></div>
    </article>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><span className="eyebrow">PERFORMANCE</span><h2>{hasLiveData ? "Shopify sales trend" : "Revenue & profit trend"}</h2></div><div className="legend"><span className="blue-dot"/>{hasLiveData ? "Net sales" : "Revenue"} <span className="green-dot"/>{hasLiveData ? "Gross sales" : "Net profit"} <span className="orange-dot"/>{hasLiveData ? "Shipping revenue" : "Ad spend"}</div></div>
        <div className="chart-wrap"><div className="y-axis"><span>{hasLiveData ? formatter.format(chartMaximum) : "£300k"}</span><span>{hasLiveData ? formatter.format(chartMaximum / 2) : "£200k"}</span><span>{hasLiveData ? formatter.format(chartMaximum / 4) : "£100k"}</span><span>£0</span></div><div className="bar-chart">{chartMonths.map((month, index) => <div className="bar-group" key={`${month}-${index}`}><div className="bars"><i className="revenue" style={{height:`${(chartRevenue[index] / chartMaximum) * 100}%`}}/><i className="profit" style={{height:`${(chartProfit[index] / chartMaximum) * 100}%`}}/><i className="spend" style={{height:`${(chartSpend[index] / chartMaximum) * 100}%`}}/></div><span>{month}</span></div>)}</div></div>
      </article>
      <article className="panel health-panel"><div className="panel-head"><div><span className="eyebrow">DATA HEALTH</span><h2>Store readiness</h2></div><span className="score">86%</span></div>
        <div className="health-ring"><div><strong>86</strong><span>Good</span></div></div>
        <ul className="health-list"><li><span className="status success"/>Shopify synced <b>2m ago</b></li><li><span className="status success"/>Ad accounts connected <b>2 of 2</b></li><li><span className="status warn"/>Missing product costs <b>14 SKUs</b></li></ul>
      </article>
      <article className="panel channel-panel"><div className="panel-head"><div><span className="eyebrow">ACQUISITION</span><h2>Channel performance</h2></div><button className="text-button">View UTM report <ArrowUpRight/></button></div>
        <div className="channel-table"><div className="channel-row header"><span>Channel</span><span>Spend</span><span>Shopify revenue</span><span>ROAS</span><span>Revenue mix</span></div>{channels.map(channel => <div className="channel-row" key={channel.name}><span className="channel-name"><i style={{background:channel.color}}/>{channel.name}</span><span>{channel.spend}</span><strong>{channel.revenue}</strong><span>{channel.roas}</span><span className="mix"><i style={{width:`${channel.share}%`, background:channel.color}}/></span></div>)}</div>
      </article>
      <article className="panel activity-panel"><div className="panel-head"><div><span className="eyebrow">ATTENTION</span><h2>Profit opportunities</h2></div></div>
        <div className="opportunity"><span className="opp-icon purple"><Sparkles/></span><div><strong>14 products need costs</strong><p>£8,420 revenue has unknown margin.</p></div><button>Add costs</button></div>
        <div className="opportunity"><span className="opp-icon green"><TrendingUp/></span><div><strong>Google Brand is outperforming</strong><p>ROAS improved 22% this period.</p></div><button>Explore</button></div>
        <div className="opportunity"><span className="opp-icon orange"><Megaphone/></span><div><strong>Campaign naming mismatch</strong><p>3 campaigns need UTM mapping.</p></div><button>Fix</button></div>
      </article>
    </section>
  </>;
}

function ProfitLoss() {
  const rows = [["Gross sales","£279,402","£264,128","£251,930","£287,690","£416,007","£258,592"],["Discounts","-£18,204","-£16,770","-£15,204","-£17,620","-£24,341","-£14,740"],["Returns","-£7,812","-£9,133","-£8,390","-£9,218","-£12,451","-£7,270"],["Net sales","£253,386","£238,225","£228,336","£260,852","£379,215","£236,582"],["COGS","-£106,680","-£102,498","-£99,852","-£97,781","-£151,909","-£93,095"],["Gross profit","£146,706","£135,727","£128,484","£163,071","£227,306","£143,487"],["Marketing","-£23,658","-£27,062","-£30,174","-£34,655","-£39,826","-£27,911"],["Transaction & shipping","-£18,405","-£17,909","-£18,175","-£21,104","-£30,676","-£22,659"],["Net profit","£104,643","£90,756","£80,135","£107,312","£156,804","£92,917"]];
  return <section className="panel report-panel"><div className="report-summary"><div><span>NET SALES</span><strong>£236,582</strong><Trend>+11.2%</Trend></div><div><span>GROSS PROFIT</span><strong>£143,487</strong><Trend>+9.4%</Trend></div><div><span>MARKETING</span><strong>£27,911</strong><Trend positive={false}>+4.1%</Trend></div><div><span>NET PROFIT</span><strong>£92,917</strong><Trend>+18.2%</Trend></div></div><div className="table-scroll"><table className="data-table pnl-table"><thead><tr><th>Income statement</th>{months.map(month=><th key={month}>{month} 2026</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr className={[3,5,8].includes(index)?"total":""} key={row[0]}>{row.map((cell,i)=><td key={cell}>{i===0 && ![3,5,8].includes(index)?<span className="indent">{cell}</span>:cell}</td>)}</tr>)}</tbody></table></div></section>;
}

function UTMAnalysis() {
  return <><section className="metric-grid compact"><article className="metric-card"><div className="metric-head"><span>Attributed sales</span></div><strong>£204,050</strong><div className="metric-foot"><Trend>+14.8%</Trend><span>79% of net sales</span></div></article><article className="metric-card"><div className="metric-head"><span>Attributed orders</span></div><strong>319</strong><div className="metric-foot"><Trend>+9.2%</Trend><span>£640 AOV</span></div></article><article className="metric-card"><div className="metric-head"><span>New customer sales</span></div><strong>£146,920</strong><div className="metric-foot"><Trend>+17.1%</Trend><span>72% of attributed</span></div></article><article className="metric-card"><div className="metric-head"><span>Mapped ROAS</span></div><strong>8.4x</strong><div className="metric-foot"><Trend>+0.8x</Trend><span>on £24,290 spend</span></div></article></section><section className="panel report-panel"><div className="panel-head"><div><span className="eyebrow">LAST-TOUCH ATTRIBUTION</span><h2>Sales by UTM</h2></div><div className="segmented"><button className="active">Source</button><button>Campaign</button><button>Content</button></div></div><div className="filter-row"><div className="search"><Search/><input placeholder="Search UTMs..."/></div><button className="filter-button">All mediums <ChevronDown/></button><button className="filter-button">All campaigns <ChevronDown/></button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Net sales</th><th>Orders</th><th>AOV</th><th>ROAS</th></tr></thead><tbody>{utms.map(row=><tr key={row.join()}>{row.map((cell,i)=><td key={cell}>{i===0?<span className="utm-source"><i/>{cell}</span>:cell}</td>)}</tr>)}</tbody></table></div><div className="table-footer"><span>Showing 5 of 48 UTM combinations</span><button>View unattributed diagnostics</button></div></section></>;
}

type CostVariant = { id: string; title: string; sku: string | null; price: string; shopify_unit_cost: string | null; currency: string; productTitle: string };
type ProductCost = { id: string; variant_id: string | null; sku: string | null; source: string; amount: string; currency: string; effective_from: string; effective_to: string | null; notes: string | null };

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

function Costs() {
  const [variants, setVariants] = useState<CostVariant[]>([]);
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [currency, setCurrency] = useState("GBP");
  const [canEdit, setCanEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => fetch("/api/costs").then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load costs");
    setVariants(payload.variants ?? []); setCosts(payload.costs ?? []); setCurrency(payload.currency ?? "GBP"); setCanEdit(Boolean(payload.canEdit));
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load costs"));

  useEffect(() => { load(); }, []);

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
    });
    await saveItems(items, "csv", file.name);
  };

  const currentDate = new Date().toISOString().slice(0, 10);
  const currentCosts = new Map(costs.filter((cost) => cost.effective_from <= currentDate && (!cost.effective_to || cost.effective_to >= currentDate)).map((cost) => [cost.variant_id ?? `sku:${cost.sku?.toLowerCase()}`, cost]));
  const covered = variants.filter((variant) => currentCosts.has(variant.id) || (variant.sku && currentCosts.has(`sku:${variant.sku.toLowerCase()}`)) || variant.shopify_unit_cost !== null).length;
  const coverage = variants.length ? Math.round((covered / variants.length) * 100) : 0;
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });

  return <>
    <section className="cost-toolbar">
      <div><span className="eyebrow">COST ENGINE</span><h2>Product cost history</h2><p>Costs apply from their effective date, so future changes do not rewrite historical profit.</p></div>
      <div className="feature-actions"><button className="primary" disabled={!canEdit} onClick={()=>setShowAdd(true)}><Plus/> Add product cost</button><label className={canEdit?"csv-button":"csv-button disabled"}><Upload/> Import CSV<input type="file" accept=".csv,text/csv" disabled={!canEdit || saving} onChange={(event)=>{const file=event.target.files?.[0];if(file) void importCsv(file);event.target.value="";}}/></label></div>
    </section>
    {error && <div className="connection-error cost-error">{error}</div>}
    <section className="cost-grid live"><div><strong>{variants.length.toLocaleString()}</strong><span>Variants synced</span></div><div><strong>{coverage}%</strong><span>Current cost coverage</span></div><div><strong>{Math.max(variants.length-covered,0).toLocaleString()}</strong><span>Missing costs</span></div><div><strong>{costs.length.toLocaleString()}</strong><span>Cost records</span></div></section>
    <section className="panel report-panel cost-table-panel"><div className="panel-head"><div><span className="eyebrow">EFFECTIVE-DATED RECORDS</span><h2>Product costs</h2></div><a className="template-link" href="data:text/csv;charset=utf-8,sku%2Camount%2Ccurrency%2Ceffective_from%2Ceffective_to%2Cnotes%0AEXAMPLE-SKU%2C12.50%2CGBP%2C2026-01-01%2C%2COptional%20note" download="product-cost-template.csv">Download CSV template</a></div>
      {variants.length===0?<div className="cost-empty"><WalletCards/><strong>No Shopify variants yet</strong><span>Connect Shopify and run the first sync before adding variant costs. CSV rows with a SKU can still be imported.</span></div>:<div className="table-scroll"><table className="data-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Source</th><th>Unit cost</th><th>Effective from</th><th>Effective to</th></tr></thead><tbody>{costs.length===0?<tr><td colSpan={6} className="empty-row">No cost records yet. Add one manually or import the CSV template.</td></tr>:costs.map((cost)=>{const variant=cost.variant_id?variantMap.get(cost.variant_id):undefined;return <tr key={cost.id}><td><strong>{variant?.productTitle ?? "SKU fallback"}</strong><small>{variant?.title ?? cost.notes ?? "Unmatched variant"}</small></td><td>{cost.sku || variant?.sku || "—"}</td><td><span className={`source-pill ${cost.source}`}>{cost.source.replace("_"," ")}</span></td><td><strong>{formatter.format(Number(cost.amount))}</strong></td><td>{cost.effective_from}</td><td>{cost.effective_to || "Ongoing"}</td></tr>})}</tbody></table></div>}
    </section>
    {showAdd&&<div className="modal-backdrop"><section className="connection-modal"><button className="modal-close" onClick={()=>setShowAdd(false)}><X/></button><div className="modal-brand"><span className="source-logo c"><WalletCards/></span><div><span className="eyebrow">COST ENGINE</span><h2>Add product cost</h2></div></div><p className="modal-intro">Choose a synced Shopify variant and the date this cost starts applying.</p>
      <label className="form-field"><span>Product variant</span><select value={variantId} onChange={(event)=>setVariantId(event.target.value)}><option value="">Select a variant</option>{variants.map((variant)=><option key={variant.id} value={variant.id}>{variant.productTitle} — {variant.title}{variant.sku?` (${variant.sku})`:""}</option>)}</select></label>
      <div className="cost-form-grid"><label className="form-field"><span>Unit cost</span><input inputMode="decimal" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="0.00"/></label><label className="form-field"><span>Currency</span><input value={currency} onChange={(event)=>setCurrency(event.target.value.toUpperCase())} maxLength={3}/></label><label className="form-field"><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(event)=>setEffectiveFrom(event.target.value)}/></label><label className="form-field"><span>Effective to <small>Optional</small></span><input type="date" value={effectiveTo} onChange={(event)=>setEffectiveTo(event.target.value)}/></label></div>
      <label className="form-field"><span>Notes <small>Optional</small></span><input value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Supplier, landed cost, or reason for change"/></label>
      {error&&<div className="connection-error">{error}</div>}<div className="modal-actions"><button onClick={()=>setShowAdd(false)}>Cancel</button><button className="primary" disabled={!variantId || !amount || saving} onClick={saveManual}>{saving?"Saving…":"Save cost"}</button></div>
    </section></div>}
  </>;
}

function Connections() {
  const [showMetaSetup, setShowMetaSetup] = useState(false);
  const [showShopifySetup, setShowShopifySetup] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaAccountName, setMetaAccountName] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [savingConnection, setSavingConnection] = useState(false);
  const [shopDomain, setShopDomain] = useState("");
  const [shopifyToken, setShopifyToken] = useState("");
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyName, setShopifyName] = useState("");
  const [shopifySyncResult, setShopifySyncResult] = useState("");

  useEffect(() => {
    fetch("/api/connections/meta")
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.connection) return;
        setMetaConnected(payload.connection.status === "connected");
        setAccountId(payload.connection.external_account_id ?? "");
        setMetaAccountName(payload.connection.external_account_name ?? "");
      })
      .catch(() => undefined);
    fetch("/api/connections/shopify")
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.connection) return;
        setShopifyConnected(payload.connection.status === "connected");
        setShopifyName(payload.connection.external_account_name ?? "");
      })
      .catch(() => undefined);
  }, []);

  const saveMeta = async () => {
    if (!token.trim()) return;
    setSavingConnection(true);
    setConnectionError("");
    const response = await fetch("/api/connections/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token.trim(), accountId: accountId.trim() }),
    });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) {
      setConnectionError(payload.error ?? "Could not connect Meta Ads");
      return;
    }
    setMetaConnected(true);
    setMetaAccountName(payload.connection?.external_account_name ?? "");
    setAccountId(payload.connection?.external_account_id ?? accountId);
    setToken("");
    setShowMetaSetup(false);
  };

  const disconnectMeta = async () => {
    setSavingConnection(true);
    const response = await fetch("/api/connections/meta", { method: "DELETE" });
    setSavingConnection(false);
    if (!response.ok) {
      const payload = await response.json();
      setConnectionError(payload.error ?? "Could not disconnect Meta Ads");
      return;
    }
    setToken(""); setAccountId(""); setMetaAccountName(""); setMetaConnected(false); setShowMetaSetup(false);
  };

  const saveShopify = async () => {
    if (!shopDomain.trim() || !shopifyToken.trim()) return;
    setSavingConnection(true); setConnectionError(""); setShopifySyncResult("");
    const response = await fetch("/api/connections/shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopDomain, accessToken: shopifyToken }) });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) { setConnectionError(payload.error ?? "Could not connect Shopify"); return; }
    setShopifyConnected(true); setShopifyName(payload.connection?.external_account_name ?? shopDomain); setShopifyToken("");
    setShopifySyncResult(`${payload.sync?.products ?? 0} products, ${payload.sync?.variants ?? 0} variants, ${payload.sync?.orders ?? 0} orders and ${payload.sync?.customers ?? 0} customers imported`);
  };

  const connections = [
    ["Shopify", "Sales, orders, products & customers", shopifyConnected ? "Connected" : "Connect", "S"],
    ["Meta Ads", "Campaign spend & performance", metaConnected ? "Connected" : "Connect", "M"],
    ["Google Ads", "Campaign and keyword reporting", "Coming next", "G"],
    ["Klaviyo", "Campaign and flow analytics", "Coming next", "K"],
  ];

  return <>
    <div className="connection-notice"><Info/><div><strong>Secure connection storage</strong><span>Access tokens are encrypted in Supabase Vault and are never returned to the browser after saving.</span></div></div>
    <section className="connection-grid">{connections.map(([name,desc,status,letter])=><article className="connection-card" key={name}><div className={`source-logo ${letter.toLowerCase()}`}>{letter}</div><div><h3>{name}</h3><p>{desc}</p></div><button disabled={status === "Coming next"} onClick={()=>name === "Meta Ads" ? setShowMetaSetup(true) : name === "Shopify" && setShowShopifySetup(true)} className={status==="Connected"?"connected":""}>{status==="Connected"&&<span/>}{status}</button></article>)}</section>
    {showShopifySetup && <div className="modal-backdrop" onMouseDown={()=>setShowShopifySetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowShopifySetup(false)}><X/></button><div className="modal-brand"><div className="source-logo s">S</div><div><span className="eyebrow">PRIMARY SALES SOURCE</span><h2>Connect Shopify</h2></div></div>
      <p className="modal-intro">Connect an Admin API token to validate the store and import catalogue, order, customer, refund and attribution data.</p>
      {shopifyConnected && shopifyName && <div className="connected-account"><span/><div><small>CONNECTED STORE</small><strong>{shopifyName}</strong></div></div>}
      <div className="help-card"><Info/><div><strong>Required access scopes</strong><ol><li>Open your app in Shopify Dev Dashboard.</li><li>Grant <code>read_products</code>, <code>read_inventory</code>, <code>read_orders</code> and <code>read_customers</code>.</li><li>Install or reinstall the app on the store and copy its Admin API token.</li></ol><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">Open Shopify Dev Dashboard <ExternalLink/></a></div></div>
      <label className="form-field"><span>Store domain</span><input value={shopDomain} onChange={(event)=>setShopDomain(event.target.value)} placeholder="your-store.myshopify.com"/></label>
      <label className="form-field"><span>Admin API access token <b className="tooltip-trigger">?<em>Use an Admin API token with product, inventory, order and customer read scopes.</em></b></span><div className="secret-input"><KeyRound/><input value={shopifyToken} onChange={(event)=>setShopifyToken(event.target.value)} type={showToken?"text":"password"} placeholder="shpat_..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      {shopifySyncResult && <div className="connected-account"><span/><div><small>CATALOGUE SYNC COMPLETE</small><strong>{shopifySyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions"><button onClick={()=>setShowShopifySetup(false)}>Close</button><button className="primary" disabled={!shopDomain.trim() || !shopifyToken.trim() || savingConnection} onClick={saveShopify}>{savingConnection?"Connecting & importing…":shopifyConnected?"Reconnect & sync":"Connect & import"}</button></div>
    </section></div>}
    {showMetaSetup && <div className="modal-backdrop" onMouseDown={()=>setShowMetaSetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowMetaSetup(false)}><X/></button>
      <div className="modal-brand"><div className="source-logo m">M</div><div><span className="eyebrow">DATA CONNECTION</span><h2>Connect Meta Ads</h2></div></div>
      <p className="modal-intro">Paste a Meta access token from the Graph API Explorer. We&apos;ll verify it against Meta, discover the ad account and store it encrypted.</p>
      {metaConnected && metaAccountName && <div className="connected-account"><span/><div><small>CURRENT ACCOUNT</small><strong>{metaAccountName}</strong></div></div>}
      <div className="help-card"><Info/><div><strong>Where do I find my token?</strong><ol><li>Open Meta&apos;s Graph API Explorer.</li><li>Select your Meta app and user.</li><li>Add <code>ads_read</code> and <code>read_insights</code> permissions.</li><li>Click Generate Access Token, then paste it below.</li></ol><a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Open Graph API Explorer <ExternalLink/></a></div></div>
      <label className="form-field"><span>Access token <b className="tooltip-trigger">?<em>Generate this in Meta Graph API Explorer with ads_read and read_insights permissions.</em></b></span><div className="secret-input"><KeyRound/><input value={token} onChange={(event)=>setToken(event.target.value)} type={showToken?"text":"password"} placeholder="EAAB..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      <label className="form-field"><span>Ad account ID <small>Optional</small></span><input value={accountId} onChange={(event)=>setAccountId(event.target.value)} placeholder="act_123456789"/></label>
      <div className="permission-note"><KeyRound/><span><strong>Required permissions:</strong> ads_read, read_insights</span></div>
      {connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{metaConnected&&<button className="danger-button" disabled={savingConnection} onClick={disconnectMeta}>Disconnect</button>}<button onClick={()=>setShowMetaSetup(false)}>Cancel</button><button className="primary" disabled={!token.trim() || savingConnection} onClick={saveMeta}>{savingConnection?"Checking…":metaConnected?"Update connection":"Verify & save"}</button></div>
    </section></div>}
  </>;
}

function Generic({ view }: { view: View }) { return <section className="panel empty-feature"><div className="feature-icon"><BarChart3/></div><span className="eyebrow">COMING INTO FOCUS</span><h2>{view}</h2><p>The product shell is ready. This report will use the same trusted Shopify financial model, filters and export workflow.</p><button className="primary"><Plus/> Create report</button></section>; }

export function AnalyticsApp() {
  const [view, setView] = useState<View>("Overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();
  const logout = async () => { await createClient().auth.signOut(); router.push("/auth/login"); router.refresh(); };
  const sync = () => { setSyncing(true); window.setTimeout(()=>setSyncing(false),1200); };
  return <div className="app-shell">
    <aside className={mobileOpen?"sidebar open":"sidebar"}><div className="brand"><span className="brand-mark"><BarChart3/></span><span>Cr8or <b>Data</b></span><button className="mobile-close" onClick={()=>setMobileOpen(false)}><X/></button></div><button className="store-switcher"><span className="store-icon"><ShoppingBag/></span><span><small>STORE</small><b>HairMax UK</b></span><ChevronDown/></button><nav>{nav.map((item)=><div key={item.label}>{item.section&&<span className="nav-section">{item.section}</span>}<button className={view===item.label?"nav-item active":"nav-item"} onClick={()=>{setView(item.label);setMobileOpen(false)}}><item.icon/><span>{item.label}</span>{item.label==="Costs"&&<em>14</em>}</button></div>)}</nav><div className="sidebar-bottom"><button className="nav-item"><Settings/><span>Settings</span></button><button className="nav-item" onClick={logout}><LogOut/><span>Sign out</span></button><div className="user-card"><div>JC</div><span><b>James</b><small>james@cr8or.co.uk</small></span></div></div></aside>
    <main className="main"><header className="topbar"><button className="menu-button" onClick={()=>setMobileOpen(true)}><Menu/></button><div className="breadcrumb"><span>HairMax UK</span><b>/</b><strong>{view}</strong></div><div className="top-actions"><button className="date-button"><CalendarDays/><span>1 Sep – 16 Sep 2026</span><ChevronDown/></button><button className="icon-button" onClick={sync} title="Sync data"><RefreshCw className={syncing?"spin":""}/></button><button className="export-button"><Download/> Export</button></div></header>
      <div className="content"><div className="page-heading"><div><span className="eyebrow">ECOMMERCE INTELLIGENCE</span><h1>{view}</h1><p>{view==="Overview"?"A clear view of what your store earned—not just what it sold.":view==="UTM Analysis"?"Understand which traffic sources create profitable customers.":view==="Profit & Loss"?"Your complete ecommerce income statement, reconciled by month.":`Manage and analyse your ${view.toLowerCase()}.`}</p></div><div className="freshness"><span className={syncing?"sync-dot syncing":"sync-dot"}/><div><small>{syncing?"SYNCING NOW":"DATA FRESH"}</small><b>{syncing?"Updating Shopify…":"Shopify synced 2m ago"}</b></div></div></div>
        {view==="Overview"?<Overview/>:view==="Profit & Loss"?<ProfitLoss/>:view==="UTM Analysis"?<UTMAnalysis/>:view==="Costs"?<Costs/>:view==="Connections"?<Connections/>:<Generic view={view}/>}</div>
    </main>
  </div>;
}
