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

const metrics = [
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

function Overview() {
  return <>
    <section className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}>
      <div className="metric-head"><span>{metric.label}</span><CircleDollarSign /></div>
      <strong>{metric.value}</strong>
      <div className="metric-foot"><Trend positive={metric.positive}>{metric.delta}</Trend><span>{metric.hint}</span></div>
    </article>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><span className="eyebrow">PERFORMANCE</span><h2>Revenue & profit trend</h2></div><div className="legend"><span className="blue-dot"/>Revenue <span className="green-dot"/>Net profit <span className="orange-dot"/>Ad spend</div></div>
        <div className="chart-wrap"><div className="y-axis"><span>£300k</span><span>£200k</span><span>£100k</span><span>£0</span></div><div className="bar-chart">{months.map((month, index) => <div className="bar-group" key={month}><div className="bars"><i className="revenue" style={{height:`${revenue[index]}%`}}/><i className="profit" style={{height:`${profit[index]}%`}}/><i className="spend" style={{height:`${spend[index]}%`}}/></div><span>{month}</span></div>)}</div></div>
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

function Costs() { return <section className="panel empty-feature"><div className="feature-icon"><WalletCards/></div><span className="eyebrow">COST ENGINE</span><h2>Make every order genuinely profitable</h2><p>Add product costs, shipping, payment fees and recurring expenses. Effective dates preserve historical reporting when costs change.</p><div className="feature-actions"><button className="primary"><Plus/> Add product cost</button><button><Upload/> Import CSV</button></div><div className="cost-grid"><div><strong>1,284</strong><span>Products synced</span></div><div><strong>97.8%</strong><span>Cost coverage</span></div><div><strong>14</strong><span>Missing costs</span></div><div><strong>£4.85</strong><span>Avg. shipping cost</span></div></div></section>; }

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
    setShopifySyncResult(`${payload.sync?.products ?? 0} products and ${payload.sync?.variants ?? 0} variants imported`);
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
      <p className="modal-intro">Connect an Admin API token to validate the store and import the complete product and variant catalogue.</p>
      {shopifyConnected && shopifyName && <div className="connected-account"><span/><div><small>CONNECTED STORE</small><strong>{shopifyName}</strong></div></div>}
      <div className="help-card"><Info/><div><strong>Required access scopes</strong><ol><li>Open your app in Shopify Dev Dashboard.</li><li>Grant <code>read_products</code> and <code>read_inventory</code>.</li><li>Install the app on the store and copy its Admin API token.</li></ol><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">Open Shopify Dev Dashboard <ExternalLink/></a></div></div>
      <label className="form-field"><span>Store domain</span><input value={shopDomain} onChange={(event)=>setShopDomain(event.target.value)} placeholder="your-store.myshopify.com"/></label>
      <label className="form-field"><span>Admin API access token <b className="tooltip-trigger">?<em>Use an Admin API token with read_products and read_inventory scopes.</em></b></span><div className="secret-input"><KeyRound/><input value={shopifyToken} onChange={(event)=>setShopifyToken(event.target.value)} type={showToken?"text":"password"} placeholder="shpat_..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
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
