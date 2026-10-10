"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { PanelState } from "@/components/ui/panel-state";
import Image from "next/image";
import "./pnl-period-navigation.css";
import { ShopifyCustomerReport } from "@/components/shopify-customer-report";
import { LeadOverview } from "@/components/lead-overview";
import { LeadReportPage } from "@/components/lead-report-page";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BarChart3, CalendarDays, ChevronDown, LogOut, Menu, Plus, RefreshCw, ShoppingBag, Table2, X } from "lucide-react";
import { LeadRevenuePage } from "@/components/lead-revenue";
import { TeamPage } from "@/components/team-page";
import { type View, type DrilldownContext, type FinanceDatePreset, financeDateRange, ecommerceNav, leadGenerationNav } from "@/components/analytics/shared";

// Each screen is its own chunk, loaded when first opened.
const screenLoading = () => <PanelState status="loading" lines={6} message="Loading…"/>;
const Connections = dynamic(() => import("@/components/screens/connections").then((module) => module.Connections), { loading: screenLoading });
const Costs = dynamic(() => import("@/components/screens/costs").then((module) => module.Costs), { loading: screenLoading });
const Customers = dynamic(() => import("@/components/screens/customers").then((module) => module.Customers), { loading: screenLoading });
const Expenses = dynamic(() => import("@/components/screens/expenses").then((module) => module.Expenses), { loading: screenLoading });
const Leads = dynamic(() => import("@/components/screens/leads").then((module) => module.Leads), { loading: screenLoading });
const Overview = dynamic(() => import("@/components/screens/overview").then((module) => module.Overview), { loading: screenLoading });
const Products = dynamic(() => import("@/components/screens/products").then((module) => module.Products), { loading: screenLoading });
const ProfitLoss = dynamic(() => import("@/components/screens/profit-loss").then((module) => module.ProfitLoss), { loading: screenLoading });
const Reports = dynamic(() => import("@/components/screens/reports").then((module) => module.Reports), { loading: screenLoading });
const Sales = dynamic(() => import("@/components/screens/sales").then((module) => module.Sales), { loading: screenLoading });
const SettingsView = dynamic(() => import("@/components/screens/settings").then((module) => module.SettingsView), { loading: screenLoading });
const UTMAnalysis = dynamic(() => import("@/components/screens/utm-analysis").then((module) => module.UTMAnalysis), { loading: screenLoading });

/** URL form of a view: "Profit & Loss" → "profit-loss". */
const viewSlug = (view: string) => view.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const allViews = [...new Set([...ecommerceNav, ...leadGenerationNav].map((item) => item.label))];
const viewFromSlug = (slug: string | null): View | null => allViews.find((candidate) => viewSlug(candidate) === slug) ?? null;

function Generic({ view }: { view: View }) { return <section className="panel empty-feature"><div className="feature-icon"><BarChart3/></div><span className="eyebrow">COMING INTO FOCUS</span><h2>{view}</h2><p>The product shell is ready. This report will use the same trusted Shopify financial model, filters and export workflow.</p><button className="primary"><Plus/> Create report</button></section>; }

type ReportingSourceFreshness = { source: string; label: string; status: "ok" | "failed" | "pending"; lastRefreshedAt: string | null; message: string | null };

type Freshness = { connected: boolean; storeName: string | null; lastSuccessfulSync: string | null; recordsProcessed: number; warnings: number; latestStatus: string | null; latestError: string | null; reporting: { running: boolean; lastRunAt: string | null; sources: ReportingSourceFreshness[] } | null };

type WorkspaceData = {
  activeOrganizationId: string;
  activeStoreId: string | null;
  organizations: Array<{ id: string; name: string; role: "owner" | "admin" | "analyst" | "connector" | "viewer" }>;
  stores: Array<{ id: string; organizationId: string; name: string; currency: string; reportingCurrency: string; timezone: string; businessModel: "ecommerce" | "lead_generation" }>;
};

export function AnalyticsApp({ initialViewSlug = null }: { initialViewSlug?: string | null }) {
  const [view, setView] = useState<View>(() => viewFromSlug(initialViewSlug) ?? "Overview");
  const goTo = useCallback((next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") === viewSlug(next)) return;
    url.searchParams.set("view", viewSlug(next));
    window.history.pushState(null, "", url);
  }, []);
  useEffect(() => {
    // Back/forward between screens.
    const restore = () => setView(viewFromSlug(new URLSearchParams(window.location.search).get("view")) ?? "Overview");
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const [costSku, setCostSku] = useState<string | null>(null);
  const [pnlPreset, setPnlPreset] = useState<"all_imported" | "latest_30_days" | "latest_90_days" | "latest_365_days">("latest_365_days");
  const [activeReportRun, setActiveReportRun] = useState<{ id: string; view: View } | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownContext | null>(null);
  const [account, setAccount] = useState({ name: "Account", email: "" });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customersExpanded, setCustomersExpanded] = useState(true);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [switchingStore, setSwitchingStore] = useState(false);
  const [syncingReporting, setSyncingReporting] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [leadDatePreset, setLeadDatePreset] = useState<FinanceDatePreset>("all_imported");
  const [leadFrom, setLeadFrom] = useState("");
  const [leadTo, setLeadTo] = useState("");
  const [leadDatePickerOpen, setLeadDatePickerOpen] = useState(false);
  const [leadDateReady, setLeadDateReady] = useState(false);
  const router = useRouter();
  const activeStore = workspace?.stores.find((store) => store.id === workspace.activeStoreId);
  const activeStoreName = activeStore?.name || freshness?.storeName || "Your store";
  const businessModel = activeStore?.businessModel ?? "ecommerce";
  useEffect(() => {
    if (!activeStore?.id) return;
    const key = `spine:lead-period:${activeStore.id}`;
    const timeout = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const value = JSON.parse(saved) as { preset?: FinanceDatePreset; from?: string; to?: string };
          if (value.preset && ["today", "yesterday", "last_7_days", "last_7_complete_days", "last_30_days", "last_30_complete_days", "last_90_days", "last_365_days", "this_month", "last_month", "all_imported", "custom"].includes(value.preset)) {
            setLeadDatePreset(value.preset);
            setLeadFrom(value.from ?? "");
            setLeadTo(value.to ?? "");
          }
        }
      } catch { /* Ignore a malformed saved date filter. */ }
      setLeadDateReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeStore?.id]);
  useEffect(() => {
    if (!leadDateReady || !activeStore?.id) return;
    localStorage.setItem(`spine:lead-period:${activeStore.id}`, JSON.stringify({ preset: leadDatePreset, from: leadFrom, to: leadTo }));
  }, [activeStore?.id, leadDatePreset, leadFrom, leadTo, leadDateReady]);
  const availableNav = businessModel === "lead_generation" ? leadGenerationNav : ecommerceNav;
  if (view !== "Overview" && !availableNav.some((item) => item.label === view)) setView("Overview");
  useEffect(() => {
    fetch("/api/workspace")
      .then(async (response) => response.ok ? response.json() as Promise<WorkspaceData> : null)
      .then((payload) => setWorkspace(payload))
      .catch(() => setWorkspace(null));
    fetch("/api/analytics/freshness")
      .then(async (response) => response.ok ? response.json() as Promise<Freshness> : null)
      .then((payload) => setFreshness(payload))
      .catch(() => setFreshness(null));
  }, []);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => { const user = data.user; if (!user) return; const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : typeof user.user_metadata?.name === "string" ? user.user_metadata.name : ""; setAccount({ name: metadataName || user.email?.split("@")[0] || "Account", email: user.email || "" }); }); }, []);
  const switchStore = async (storeId: string) => {
    const store = workspace?.stores.find((candidate) => candidate.id === storeId);
    if (!store || store.id === workspace?.activeStoreId) return;
    setSwitchingStore(true);
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: store.organizationId, storeId: store.id }),
    }).catch(() => null);
    if (!response?.ok) {
      setSwitchingStore(false);
      return;
    }
    window.location.reload();
  };
  const leadRangeLabel = leadDatePreset === "custom" && leadFrom && leadTo ? `${leadFrom} to ${leadTo}` : leadDatePreset === "all_imported" ? "All imported data" : ({ today: "Today", yesterday: "Yesterday", last_7_days: "Last 7 days", last_7_complete_days: "Last 7 complete days", last_30_days: "Last 30 days", last_30_complete_days: "Last 30 complete days", last_90_days: "Last 90 days", last_365_days: "Last 365 days", this_month: "This month", last_month: "Last month", custom: "Custom dates", all_imported: "All imported data" } as Record<FinanceDatePreset, string>)[leadDatePreset];
  const updateLeadPreset = (preset: FinanceDatePreset) => { setLeadDatePreset(preset); if (preset !== "custom") { const dates = financeDateRange(preset); setLeadFrom(dates.from); setLeadTo(dates.to); } };
  const logout = async () => { await createClient().auth.signOut(); router.push("/auth/login"); router.refresh(); };
  const openSync = () => { setDrilldown(null); goTo("Connections"); setMobileOpen(false); };
  const syncReportingNow = async () => {
    setSyncingReporting(true); setSyncError("");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Sync could not be started");
      window.location.reload();
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : "Sync could not be started");
      setSyncingReporting(false);
    }
  };
  const openDrilldown = (target: View, context?: DrilldownContext) => { setActiveReportRun(null); setDrilldown(context ?? null); goTo(target); setMobileOpen(false); };
  const freshnessHeading = !freshness ? "SHOPIFY DATA" : !freshness.connected ? "SHOPIFY NOT CONNECTED" : freshness.latestStatus === "running" || freshness.latestStatus === "paused" ? "IMPORTING SHOPIFY" : freshness.latestStatus === "failed" || freshness.latestStatus === "interrupted" ? "SYNC NEEDS ATTENTION" : freshness.lastSuccessfulSync ? "SHOPIFY SYNCED" : "READY TO SYNC";
  const freshnessDetail = freshness?.latestStatus === "running" ? "Importing your Shopify catalogue and orders" : freshness?.latestStatus === "paused" ? "Continuing in the background each hour" : freshness?.latestStatus === "interrupted" ? "Open Connections to resume the saved import" : freshness?.lastSuccessfulSync ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(freshness.lastSuccessfulSync)) : freshness?.latestStatus === "failed" ? "Open Connections to review the failed sync" : "Open Connections to import Shopify data";
  return <div className="app-shell">
    <aside className={mobileOpen?"sidebar open":"sidebar"}><div className="brand"><span className="brand-mark"><Image src="/spine-logo.png" alt="" width={34} height={34} priority /></span><span><b>Spine</b><small>The backbone of your business</small></span><button className="mobile-close" onClick={()=>setMobileOpen(false)}><X/></button></div><label className="store-switcher"><span className="store-icon"><ShoppingBag/></span><span><small>STORE</small><b>{switchingStore ? "Switching…" : activeStoreName}</b></span><select aria-label="Active store" value={workspace?.activeStoreId ?? ""} disabled={!workspace || switchingStore || workspace.stores.length < 2} onChange={(event)=>void switchStore(event.target.value)}>{workspace?.stores.map((store)=>{const organization=workspace?.organizations.find((candidate)=>candidate.id===store.organizationId);return <option key={store.id} value={store.id}>{organization && (workspace?.organizations.length ?? 0) > 1 ? `${organization.name} · ` : ""}{store.name}</option>})}</select><ChevronDown/></label><nav>{availableNav.map((item)=>{if(item.subItem&&!customersExpanded)return null;const isCustomers=item.label==="Customers";return <div key={item.label}>{item.section&&<span className="nav-section">{item.section}</span>}<button className={`${view===item.label ? "nav-item active" : "nav-item"}${item.subItem ? " nav-sub-item" : ""}`} title={item.display ? item.label : undefined} onClick={()=>{if(isCustomers)setCustomersExpanded((expanded)=>!expanded);setActiveReportRun(null);setDrilldown(null);goTo(item.label);setMobileOpen(false)}}><item.icon/><span className="nav-label">{item.display ?? item.label}</span>{isCustomers&&<ChevronDown style={{marginLeft:"auto",transform:customersExpanded?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s"}}/>}</button></div>})}</nav><div className="sidebar-bottom"><button className="nav-item" onClick={logout}><LogOut/><span>Sign out</span></button><div className="user-card"><div>{account.name.slice(0, 2).toUpperCase()}</div><span><b>{account.name}</b><small>{account.email}</small></span></div></div></aside>
    <main className="main"><header className="topbar"><button className="menu-button" onClick={()=>setMobileOpen(true)}><Menu/></button><div className="breadcrumb"><span>{activeStoreName}</span><b>/</b><strong>{view}</strong></div><div className="top-actions">{businessModel === "lead_generation" && <div className="global-date-picker"><button className="date-button" title="Choose reporting period" onClick={() => setLeadDatePickerOpen((open) => !open)}><CalendarDays/><span>{leadRangeLabel}</span><ChevronDown/></button>{leadDatePickerOpen && <div className="global-date-menu"><label>Period<select value={leadDatePreset} onChange={(event) => updateLeadPreset(event.target.value as FinanceDatePreset)}><option value="all_imported">All imported data</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option><option value="last_90_days">Last 90 days</option><option value="last_365_days">Last 365 days</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="custom">Custom dates</option></select></label>{leadDatePreset === "custom" && <div className="global-date-custom"><label>From<input type="date" value={leadFrom} onChange={(event) => setLeadFrom(event.target.value)}/></label><label>To<input type="date" value={leadTo} onChange={(event) => setLeadTo(event.target.value)}/></label></div>}<button className="primary" onClick={() => setLeadDatePickerOpen(false)}>Apply period</button></div>}</div>}{businessModel && <button className="export-button" disabled={syncingReporting} onClick={() => void syncReportingNow()} title={businessModel === "lead_generation" ? "Refresh GoHighLevel and ad reporting data now" : "Refresh Shopify, Meta, Google and Microsoft Ads reporting data now"}><RefreshCw className={syncingReporting ? "spin" : ""}/> {syncingReporting ? "Syncing…" : "Sync now"}</button>}<button className="icon-button" onClick={openSync} title="Open Shopify sync"><RefreshCw/></button><button className="export-button" onClick={()=>goTo("Reports")}><Table2/> Reports</button></div></header>
    {syncError && <div className="connection-error" style={{margin:"0 32px"}}>{syncError}</div>}
      <div className="content"><div className="page-heading"><div><span className="eyebrow">{businessModel === "lead_generation" ? "LEAD GENERATION INTELLIGENCE" : "ECOMMERCE INTELLIGENCE"}</span><h1>{view}</h1><p>{view==="Leads"?"A standalone view of ad cost against your selected GoHighLevel conversion.":view==="Overview"?(businessModel === "lead_generation" ? "Monitor GoHighLevel stage volumes, paid-media efficiency and pipeline value." : "A clear view of what your store earned—not just what it sold."):view==="UTM Analysis"?"Understand which traffic sources create profitable customers.":view==="Profit & Loss"?"Your ecommerce income statement, based on all imported Shopify data.":`Manage and analyse your ${view.toLowerCase()}.`}</p></div><div className="freshness"><span className={freshness?.latestStatus === "failed" ? "sync-dot syncing" : "sync-dot"}/><div><small>{freshnessHeading}</small><b>{freshnessDetail}</b>{freshness?.reporting && freshness.reporting.sources.length > 0 && <ul className="source-chips" aria-label="Reporting sources">{freshness.reporting.sources.map((item) => <li key={item.source} className={`source-chip ${item.status}`} title={item.status === "failed" ? `Last refresh failed: ${item.message ?? "unknown error"}` : item.lastRefreshedAt ? `Refreshed ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastRefreshedAt))}` : "Waiting for the first background refresh"}><span aria-hidden="true"/>{item.label}</li>)}</ul>}</div></div></div>
        {view==="Overview"?(businessModel === "lead_generation" ? <LeadOverview key={activeStore?.id} range={{ from: leadFrom, to: leadTo, label: leadRangeLabel }} onOpenConnections={() => goTo("Connections")} onOpenLeads={() => goTo("Leads")}/> : <Overview reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} onDrilldown={openDrilldown} storageKey={activeStore?.id ?? "default"}/>):view==="Revenue & Costs"?<LeadRevenuePage key={activeStore?.id} range={{from:leadFrom,to:leadTo}}/>:view==="Leads"?<Leads onOpenConnections={() => goTo("Connections")} range={{ from: leadFrom, to: leadTo, label: leadRangeLabel, preset: leadDatePreset }} onRangeChange={(next) => { if (next.preset) updateLeadPreset(next.preset); if (next.from !== undefined) { setLeadDatePreset("custom"); setLeadFrom(next.from); } if (next.to !== undefined) { setLeadDatePreset("custom"); setLeadTo(next.to); } }}/>:(["Pipeline outcomes","Stage ageing","Lead sources","Sales team","Forecast","Lost reasons","Follow-ups"] as View[]).includes(view)?<LeadReportPage view={view as "Pipeline outcomes" | "Stage ageing" | "Lead sources" | "Sales team" | "Forecast" | "Lost reasons" | "Follow-ups"} range={{from:leadFrom,to:leadTo,label:leadRangeLabel}}/>:view==="Profit & Loss"?<ProfitLoss savedPreset={pnlPreset} initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} storageKey={activeStore?.id ?? "default"}/>:view==="Sales"?<Sales reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="UTM Analysis"?<UTMAnalysis initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined}/>:view==="Products"?<Products initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} openCosts={(sku) => { setCostSku(sku); setDrilldown(null); goTo("Costs"); }}/>:(view==="New versus repeat sales" || view==="Top Shopify customers" || view==="Sales by country")?<ShopifyCustomerReport focus={view==="New versus repeat sales"?"sales":view==="Sales by country"?"geography":"customers"}/>: (["Customers", "Customer cohorts", "Repurchase rates", "Time between orders", "Product journeys"] as View[]).includes(view)?<Customers initialRange={drilldown ?? undefined} reportRunId={activeReportRun?.view === view ? activeReportRun.id : undefined} focus={view === "Customer cohorts" ? "cohorts" : view === "Repurchase rates" ? "repurchase" : view === "Time between orders" ? "timing" : view === "Product journeys" ? "journeys" : "summary"}/>:view==="Costs"?<Costs focusSku={costSku}/>:view==="Expenses"?<Expenses/>:view==="Reports"?<Reports openReport={(target, preset, runId, filters) => { setPnlPreset(preset); setDrilldown(filters ?? null); setActiveReportRun({ id: runId, view: target }); goTo(target); }}/> :view==="Connections"?<Connections key={activeStore?.id} leadGeneration={businessModel === "lead_generation"} canManage={["owner","admin","connector"].includes(workspace?.organizations.find((item) => item.id === workspace.activeOrganizationId)?.role ?? "")}/>:view==="Settings"?<SettingsView/>:view==="Team"?<TeamPage key={workspace?.activeOrganizationId}/>:<Generic view={view}/>}</div>
    </main>
  </div>;
}
