"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Database, Eye, EyeOff, ExternalLink, Info, KeyRound, Search, X } from "lucide-react";
import { RevenueConnectors } from "@/components/revenue-connectors";

export function Connections({ leadGeneration = false, canManage = false }: { leadGeneration?: boolean; canManage?: boolean }) {
  const goHighLevelLogo = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSar809unLJMErZysKctuNXry5HbjlPeAfKsZargmkPag&s=10";
  const integrationLogoSources: Record<string, string> = {
    Shopify: "https://cdn.simpleicons.org/shopify/95BF47",
    "Meta Ads": "https://cdn.simpleicons.org/meta/0668E1",
    "Google Ads": "https://upload.wikimedia.org/wikipedia/commons/c/cc/Google_Ads_icon.svg",
    "Microsoft Ads": "https://upload.wikimedia.org/wikipedia/commons/9/9f/Microsoft_Advertising_Logo.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original",
    Klaviyo: "https://images.seeklogo.com/logo-png/51/1/klaviyo-logo-png_seeklogo-512370.png",
    GoHighLevel: goHighLevelLogo,
  };
  const integrationLogo = (name: string, className = "") => <span className={`source-logo brand-image ${name === "GoHighLevel" ? "ghl" : name === "Klaviyo" ? "klaviyo" : name === "Google Ads" ? "google-ads" : ""} ${className}`} role="img" aria-label={`${name} logo`} style={{ backgroundImage: `url("${integrationLogoSources[name]}")` }} />;
  const [showMetaSetup, setShowMetaSetup] = useState(false);
  const [showShopifySetup, setShowShopifySetup] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [metaAccounts, setMetaAccounts] = useState<Array<{ id: string; name: string; currency: string | null; accountStatus: number | null }>>([]);
  const [metaAccountSearch, setMetaAccountSearch] = useState("");
  const [loadingMetaAccounts, setLoadingMetaAccounts] = useState(false);
  const [metaLookbackMonths, setMetaLookbackMonths] = useState("12");
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaConnectionStatus, setMetaConnectionStatus] = useState<"connected" | "error" | "disconnected">("disconnected");
  const [metaConnectionError, setMetaConnectionError] = useState("");
  const [googleAdsConnected, setGoogleAdsConnected] = useState(false);
  const [googleAdsAccountName, setGoogleAdsAccountName] = useState("");
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<Array<{ customer_id: string; name: string; is_manager: boolean; hierarchy_level: number; direct_access: boolean }>>([]);
  const [showGoogleAdsAccounts, setShowGoogleAdsAccounts] = useState(false);
  const [selectingGoogleAdsAccount, setSelectingGoogleAdsAccount] = useState(false);
  const [bingAdsConnected, setBingAdsConnected] = useState(false);
  const [bingAdsAccountName, setBingAdsAccountName] = useState("");
  const [bingAdsAccounts, setBingAdsAccounts] = useState<Array<{ account_id: string; customer_id: string; name: string; account_number: string | null; currency: string | null; status: string | null; is_selected: boolean }>>([]);
  const [showBingAdsAccounts, setShowBingAdsAccounts] = useState(false);
  const [selectingBingAdsAccount, setSelectingBingAdsAccount] = useState(false);
  const [klaviyoConnected, setKlaviyoConnected] = useState(false);
  const [ghlConnected, setGhlConnected] = useState(false);
  const [ghlAccountName, setGhlAccountName] = useState("");
  const [showGhlSetup, setShowGhlSetup] = useState(false);
  const [ghlApiKey, setGhlApiKey] = useState("");
  const [ghlLocationId, setGhlLocationId] = useState("");
  const [ghlSourceType, setGhlSourceType] = useState<"opportunities" | "contacts">("opportunities");
  const [ghlMetricLabel, setGhlMetricLabel] = useState("Booked calls");
  const [showGhlToken, setShowGhlToken] = useState(false);
  const [metaAccountName, setMetaAccountName] = useState("");
  const [metaSyncResult, setMetaSyncResult] = useState("");
  const [metaLastSync, setMetaLastSync] = useState<{ importedDays: number; latestDate: string | null; syncedAt: string | null } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [savingConnection, setSavingConnection] = useState(false);
  const [shopDomain, setShopDomain] = useState("");
  const [shopifyToken, setShopifyToken] = useState("");
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyName, setShopifyName] = useState("");
  const [shopifyScopes, setShopifyScopes] = useState<string[]>([]);
  const [shopifyStore, setShopifyStore] = useState<{ shopify_domain: string | null; currency: string; reporting_currency: string; timezone: string | null } | null>(null);
  const [shopifySyncResult, setShopifySyncResult] = useState("");
  const [shopifyLastSync, setShopifyLastSync] = useState<{ status: string; sync_mode: "initial" | "incremental"; window_start: string | null; window_end: string | null; pages_processed: number; records_processed: number; warnings: unknown[]; error_message: string | null; completed_at: string | null; updated_at: string } | null>(null);
  const [clock, setClock] = useState(0);
  const shopifyImportPaused = shopifyLastSync?.status === "running" && Date.parse(shopifyLastSync.updated_at) < clock - 6 * 60 * 1000;
  useEffect(() => {
    const refreshClock = () => setClock(Date.now());
    const initial = window.setTimeout(refreshClock, 0);
    const interval = window.setInterval(refreshClock, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    fetch("/api/connections/meta")
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.connection) return;
        setMetaConnected(payload.connection.status === "connected");
        setMetaConnectionStatus(payload.connection.status === "connected" ? "connected" : payload.connection.status === "error" ? "error" : "disconnected");
        setMetaConnectionError(payload.connection.last_error ?? "");
        if (payload.connection.status === "error" && payload.connection.last_error) setConnectionError(payload.connection.last_error);
        setAccountId(payload.connection.external_account_id ?? "");
        setMetaAccountName(payload.connection.external_account_name ?? "");
        setMetaLastSync(payload.sync ?? null);
      })
      .catch(() => undefined);
    fetch("/api/connections/google-ads").then((response) => response.ok ? response.json() : null).then((payload) => { setGoogleAdsConnected(payload?.connection?.status === "connected"); setGoogleAdsAccountName(payload?.connection?.external_account_name ?? ""); }).catch(() => undefined);
    fetch("/api/connections/google-ads/accounts").then((response) => response.ok ? response.json() : null).then((payload) => setGoogleAdsAccounts(payload?.accounts ?? [])).catch(() => undefined);
    fetch("/api/connections/bing-ads").then((response) => response.ok ? response.json() : null).then((payload) => { setBingAdsConnected(payload?.connection?.status === "connected"); setBingAdsAccountName(payload?.connection?.external_account_name ?? ""); }).catch(() => undefined);
    fetch("/api/connections/bing-ads/accounts").then((response) => response.ok ? response.json() : null).then((payload) => setBingAdsAccounts(payload?.accounts ?? [])).catch(() => undefined);
    const googleAdsQuery = new URLSearchParams(window.location.search);
    if (googleAdsQuery.get("googleAds") === "select") {
      const discoveryError = googleAdsQuery.get("googleAdsError");
      const timeout = window.setTimeout(() => {
        setShowGoogleAdsAccounts(true);
        if (discoveryError) setConnectionError(discoveryError);
        window.history.replaceState({}, "", "/protected/connections");
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (googleAdsQuery.get("bingAds") === "select" || googleAdsQuery.get("bingAdsError")) {
      const discoveryError = googleAdsQuery.get("bingAdsError");
      const timeout = window.setTimeout(() => { setShowBingAdsAccounts(true); if (discoveryError) setConnectionError(discoveryError); window.history.replaceState({}, "", "/protected/connections"); }, 0);
      return () => window.clearTimeout(timeout);
    }
    fetch("/api/connections/klaviyo").then((response) => response.ok ? response.json() : null).then((payload) => setKlaviyoConnected(payload?.connection?.status === "connected")).catch(() => undefined);
    fetch("/api/connections/gohighlevel").then((response) => response.ok ? response.json() : null).then((payload) => { setGhlConnected(payload?.connection?.status === "connected"); setGhlAccountName(payload?.connection?.external_account_name ?? ""); }).catch(() => undefined);
    fetch("/api/connections/shopify")
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.connection) return;
        setShopifyConnected(payload.connection.status === "connected");
        setShopifyName(payload.connection.external_account_name ?? "");
        setShopifyScopes(payload.connection.granted_scopes ?? []);
        setShopifyStore(payload.store ?? null);
        setShopifyLastSync(payload.sync ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const status = query.get("metaOAuth");
    if (!status) return;
    const message = status === "connected" ? query.get("metaAccount") : query.get("metaError");
    const timeout = window.setTimeout(() => {
      setShowMetaSetup(true);
      if (status === "connected") setMetaSyncResult(`Connected through Facebook${message ? ` to ${message}` : ""}. Your selected spend history has been imported.`);
      else setConnectionError(message || "Facebook could not be connected.");
      window.history.replaceState({}, "", "/protected/connections");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const connectMetaWithFacebook = () => {
    setConnectionError("");
    const params = new URLSearchParams({ lookbackMonths: metaLookbackMonths });
    window.location.assign(`/api/connections/meta/authorize?${params}`);
  };

  const loadMetaAccounts = async () => {
    if (!token.trim()) return;
    setLoadingMetaAccounts(true);
    setConnectionError("");
    setMetaAccounts([]);
    setAccountId("");
    try {
      const response = await fetch("/api/connections/meta/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setConnectionError(payload.error ?? "Could not load Meta ad accounts");
        return;
      }
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      setMetaAccounts(accounts);
      if (accounts.length === 1) setAccountId(accounts[0].id);
      if (accounts.length === 0) setConnectionError("No ad accounts were found for this token.");
    } catch {
      setConnectionError("Could not reach Meta to load ad accounts. Try again.");
    } finally {
      setLoadingMetaAccounts(false);
    }
  };

  const saveMeta = async () => {
    if (!token.trim() || !accountId) return;
    setSavingConnection(true);
    setConnectionError("");
    const response = await fetch("/api/connections/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token.trim(), accountId: accountId.trim(), lookbackMonths: Number(metaLookbackMonths) }),
    });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) {
      setConnectionError(payload.error ?? "Could not connect Meta Ads");
      return;
    }
    setMetaConnected(true);
    setMetaConnectionStatus("connected");
    setMetaConnectionError("");
    setMetaAccountName(payload.connection?.external_account_name ?? "");
    setAccountId(payload.connection?.external_account_id ?? accountId);
    setMetaSyncResult(`${payload.sync?.importedDays ?? 0} daily Meta spend records imported (${payload.sync?.range?.since ?? "selected"} to ${payload.sync?.range?.until ?? "today"})`);
    setToken("");
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
    setToken(""); setAccountId(""); setMetaAccountName(""); setMetaSyncResult(""); setMetaLastSync(null); setMetaConnected(false); setMetaConnectionStatus("disconnected"); setMetaConnectionError(""); setShowMetaSetup(false);
  };

  const disconnectShopify = async () => {
    setSavingConnection(true); setConnectionError("");
    const response = await fetch("/api/connections/shopify", { method: "DELETE" });
    setSavingConnection(false);
    if (!response.ok) { const payload = await response.json(); setConnectionError(payload.error ?? "Could not disconnect Shopify"); return; }
    setShopifyConnected(false); setShopifyName(""); setShopifyScopes([]); setShopifyStore(null); setShopifyToken(""); setShopifySyncResult(""); setShopifyLastSync(null); setShowShopifySetup(false);
  };

  const saveShopify = async () => {
    if (!shopifyConnected && (!shopDomain.trim() || !shopifyToken.trim())) return;
    setSavingConnection(true); setConnectionError(""); setShopifySyncResult("");
    const response = await fetch("/api/connections/shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shopifyToken.trim() ? { shopDomain, accessToken: shopifyToken } : {}) });
    const payload = await response.json();
    setSavingConnection(false);
    if (!response.ok) { setConnectionError(payload.error ?? "Could not connect Shopify"); return; }
    setShopifyConnected(true); setShopifyName(payload.connection?.external_account_name ?? shopDomain); setShopifyScopes(payload.connection?.granted_scopes ?? []); setShopifyToken("");
    setShopifySyncResult(`${payload.sync?.mode === "incremental" ? "Incremental refresh" : "Historical import"}: ${payload.sync?.products ?? 0} products, ${payload.sync?.variants ?? 0} variants, ${payload.sync?.orders ?? 0} orders and ${payload.sync?.customers ?? 0} customers imported`);
    window.setTimeout(() => window.location.reload(), 750);
  };

  const connectKlaviyo = async () => { const apiKey = window.prompt("Paste your Klaviyo private API key"); if (!apiKey) return; setSavingConnection(true); const response = await fetch("/api/connections/klaviyo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) }); setSavingConnection(false); if (!response.ok) { const payload = await response.json(); setConnectionError(payload.error || "Could not connect Klaviyo"); return; } setKlaviyoConnected(true); };
  const connectGhl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ghlApiKey.trim() || !ghlLocationId.trim() || !ghlMetricLabel.trim()) return;
    setSavingConnection(true); setConnectionError("");
    try {
      const response = await fetch("/api/connections/gohighlevel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: ghlApiKey.trim(), locationId: ghlLocationId.trim(), sourceType: ghlSourceType, metricLabel: ghlMetricLabel.trim() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setConnectionError(payload.error || "GoHighLevel could not validate those details. Use a Private Integration token and the ID of the sub-account it belongs to."); return; }
      setGhlConnected(true);
      setGhlAccountName(payload.connection?.external_account_name ?? ghlLocationId.trim());
      setGhlApiKey("");
      setShowGhlSetup(false);
    } catch {
      setConnectionError("GoHighLevel could not be reached. Please try again in a moment.");
    } finally { setSavingConnection(false); }
  };
  const connectGoogleAds = () => { window.location.assign("/api/google-ads/authorize"); };
  const connectBingAds = () => { window.location.assign("/api/bing-ads/authorize"); };
  const selectGoogleAdsAccount = async (customerId: string) => {
    setSelectingGoogleAdsAccount(true); setConnectionError("");
    try {
      const response = await fetch("/api/connections/google-ads/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not select Google Ads account");
      setGoogleAdsAccountName(payload.connection?.external_account_name ?? "");
      setGoogleAdsConnected(true); setShowGoogleAdsAccounts(false);
    } catch (reason) { setConnectionError(reason instanceof Error ? reason.message : "Could not select Google Ads account"); } finally { setSelectingGoogleAdsAccount(false); }
  };
  const selectBingAdsAccount = async (accountId: string) => {
    setSelectingBingAdsAccount(true); setConnectionError("");
    try {
      const response = await fetch("/api/connections/bing-ads/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not select Microsoft Advertising account");
      setBingAdsAccountName(payload.connection?.external_account_name ?? ""); setBingAdsConnected(true); setShowBingAdsAccounts(false);
      const accounts = await fetch("/api/connections/bing-ads/accounts").then((result) => result.ok ? result.json() : null); setBingAdsAccounts(accounts?.accounts ?? []);
    } catch (reason) { setConnectionError(reason instanceof Error ? reason.message : "Could not select Microsoft Advertising account"); } finally { setSelectingBingAdsAccount(false); }
  };
  const connections = [
    ["Shopify", "Sales, orders, products & customers", shopifyConnected ? "Connected" : "Connect", "S"],
    ["Meta Ads", "Campaign spend & performance", metaConnectionStatus === "error" ? (/(expired|revoked)/i.test(metaConnectionError) ? "Expired" : "Needs attention") : metaConnected ? "Connected" : "Connect", "M"],
    ["Google Ads", googleAdsConnected ? (googleAdsAccountName || "Google Ads account") : "Campaign and keyword reporting", googleAdsConnected ? "Connected" : "Connect", "G"],
    ["Microsoft Ads", bingAdsConnected ? (bingAdsAccountName || "Microsoft Advertising account") : "Campaign spend and performance", bingAdsConnected ? "Connected" : "Connect", "B"],
    ["Klaviyo", "Campaign and flow analytics", klaviyoConnected ? "Connected" : "Connect", "K"],
    ["GoHighLevel", ghlConnected ? (ghlAccountName || "GoHighLevel location") : "Lead, call and pipeline conversion reporting", ghlConnected ? "Connected" : "Connect", "H"],
  ];
  const filteredMetaAccounts = metaAccounts.filter((account) =>
    `${account.name} ${account.currency ?? ""} ${account.id} ${account.id.startsWith("act_") ? account.id.slice(4) : `act_${account.id}`}`
      .toLocaleLowerCase()
      .includes(metaAccountSearch.trim().toLocaleLowerCase()),
  );

  return <>
    <div className="connection-notice"><Info/><div><strong>{canManage ? "Secure connection storage" : "Connection access is view only"}</strong><span>{canManage ? "Access tokens are encrypted in Supabase Vault and are never returned to the browser after saving." : "Ask an owner, admin or connections manager to add or remove integrations."}</span></div></div>{connectionError && <div className="connection-error" role="alert">{connectionError}</div>}
    <section className="connection-grid">{connections.map(([name,desc,status])=><article className="connection-card" key={name}>{integrationLogo(name)}<div><h3>{name}</h3><p>{desc}</p></div><button disabled={!canManage || status === "Coming next"} onClick={() => { if (name === "Meta Ads") setShowMetaSetup(true); else if (name === "Shopify") setShowShopifySetup(true); else if (name === "Google Ads") { if (googleAdsConnected) setShowGoogleAdsAccounts(true); else connectGoogleAds(); } else if (name === "Microsoft Ads") { if (bingAdsConnected) setShowBingAdsAccounts(true); else connectBingAds(); } else if (name === "Klaviyo") void connectKlaviyo(); else if (name === "GoHighLevel") { setConnectionError(""); setShowGhlSetup(true); } }} className={status==="Connected" ? "connected" : status === "Expired" || status === "Needs attention" ? "expired" : ""}>{(status==="Connected" || status === "Expired" || status === "Needs attention")&&<span/>}{status}</button></article>)}</section>
    {leadGeneration && <RevenueConnectors/>}
    {showGoogleAdsAccounts && <div className="modal-backdrop" onMouseDown={() => setShowGoogleAdsAccounts(false)}><section className="connection-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowGoogleAdsAccounts(false)}><X/></button><div className="modal-brand">{integrationLogo("Google Ads")}<div><span className="eyebrow">GOOGLE ADS</span><h2>Choose an ad account</h2></div></div><p className="modal-intro">Select the Google Ads account for this brand. Manager accounts and their enabled client accounts are listed separately.</p>{connectionError && <div className="connection-error">{connectionError}</div>}{googleAdsAccounts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Customer ID</th><th>Type</th><th/></tr></thead><tbody>{googleAdsAccounts.map((account) => <tr key={account.customer_id}><td><strong>{account.name}</strong>{account.direct_access && <small>Direct Google access</small>}</td><td>{account.customer_id}</td><td>{account.is_manager ? "Manager (MCC)" : "Client account"}</td><td><button className="primary" disabled={selectingGoogleAdsAccount} onClick={() => void selectGoogleAdsAccount(account.customer_id)}>{googleAdsAccountName === account.name ? "Selected" : "Use this account"}</button></td></tr>)}</tbody></table></div> : <div className="cost-empty"><Database/><strong>No Google Ads accounts have been loaded yet</strong><span>Reconnect Google Ads to load the MCC hierarchy.</span></div>}<div className="modal-actions"><button onClick={() => setShowGoogleAdsAccounts(false)}>Close</button><button className="primary" onClick={connectGoogleAds}>Reconnect and refresh accounts</button></div></section></div>}
    {showBingAdsAccounts && <div className="modal-backdrop" onMouseDown={() => setShowBingAdsAccounts(false)}><section className="connection-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowBingAdsAccounts(false)}><X/></button><div className="modal-brand">{integrationLogo("Microsoft Ads")}<div><span className="eyebrow">MICROSOFT ADVERTISING</span><h2>Choose an ad account</h2></div></div><p className="modal-intro">Select which Microsoft Advertising account supplies campaign spend for this brand.</p>{connectionError && <div className="connection-error">{connectionError}</div>}{bingAdsAccounts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Account number</th><th>Currency</th><th/></tr></thead><tbody>{bingAdsAccounts.map((account) => <tr key={account.account_id}><td><strong>{account.name}</strong><small>{account.status || "Microsoft Advertising account"}</small></td><td>{account.account_number || account.account_id}</td><td>{account.currency || "—"}</td><td><button className="primary" disabled={selectingBingAdsAccount} onClick={() => void selectBingAdsAccount(account.account_id)}>{account.is_selected ? "Selected" : "Use this account"}</button></td></tr>)}</tbody></table></div> : <div className="cost-empty"><Database/><strong>No Microsoft Advertising accounts loaded</strong><span>Reconnect Microsoft Advertising to discover the accounts available to you.</span></div>}<div className="modal-actions"><button onClick={() => setShowBingAdsAccounts(false)}>Close</button><button className="primary" onClick={connectBingAds}>Reconnect and refresh accounts</button></div></section></div>}
    {showShopifySetup && <div className="modal-backdrop" onMouseDown={()=>setShowShopifySetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowShopifySetup(false)}><X/></button><div className="modal-brand">{integrationLogo("Shopify")}<div><span className="eyebrow">PRIMARY SALES SOURCE</span><h2>Connect Shopify</h2></div></div>
      <p className="modal-intro">Connect an Admin API token to validate the store and import catalogue, order, customer, refund and attribution data. Disconnecting removes the encrypted token but preserves your imported reporting data.</p>
      {shopifyConnected && shopifyName && <div className="connected-account"><span/><div><small>CONNECTED STORE</small><strong>{shopifyName}</strong>{shopifyStore && <small>{shopifyStore.shopify_domain || "Shopify store"} · {shopifyStore.currency} · {shopifyStore.timezone || "Timezone unavailable"}</small>}{shopifyScopes.length > 0 && <small>Granted scopes: {shopifyScopes.join(", ")}</small>}</div></div>}{shopifyLastSync && <div className={shopifyLastSync.status === "failed" ? "connection-error" : "connected-account"}><span/>{shopifyLastSync.status === "failed" ? <div><small>LAST IMPORT FAILED</small><strong>{shopifyLastSync.error_message || "Open the token and try again"}</strong></div> : shopifyImportPaused ? <div><small>IMPORT PAUSED AT A SAVED CHECKPOINT</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records saved. Use Retry import to resume.</strong></div> : shopifyLastSync.status === "running" ? <div><small>IMPORT IN PROGRESS</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records saved so far.</strong></div> : <div><small>LAST IMPORT</small><strong>{shopifyLastSync.records_processed.toLocaleString()} records · {shopifyLastSync.completed_at ? new Date(shopifyLastSync.completed_at).toLocaleString("en-GB") : shopifyLastSync.status}</strong></div>}</div>}
      <div className="help-card"><Info/><div><strong>Required access scopes</strong><ol><li>Open your app in Shopify Dev Dashboard.</li><li>Grant <code>read_products</code>, <code>read_inventory</code>, <code>read_orders</code>, <code>read_customers</code> and <code>read_reports</code>.</li><li>Enable Level 2 protected customer data access for ShopifyQL reports.</li><li>Install or reinstall the app on the store and copy its Admin API token.</li></ol><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">Open Shopify Dev Dashboard <ExternalLink/></a></div></div>
      {shopifyLastSync && <div className="connection-notice"><Info/><div><strong>{shopifyLastSync.sync_mode === "incremental" ? "Rolling incremental refresh" : "Initial historical import"}</strong><span>{shopifyLastSync.pages_processed.toLocaleString()} order pages checkpointed{shopifyLastSync.window_start ? ` · refreshing changes since ${new Date(shopifyLastSync.window_start).toLocaleString("en-GB")}` : " · importing all available history"}</span></div></div>}
      <label className="form-field"><span>Store domain</span><input value={shopDomain} onChange={(event)=>setShopDomain(event.target.value)} placeholder="your-store.myshopify.com"/></label>
      <label className="form-field"><span>Admin API access token <b className="tooltip-trigger">?<em>Use an Admin API token with product, inventory, order and customer read scopes.</em></b></span><div className="secret-input"><KeyRound/><input value={shopifyToken} onChange={(event)=>setShopifyToken(event.target.value)} type={showToken?"text":"password"} placeholder="shpat_..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      {shopifySyncResult && <div className="connected-account"><span/><div><small>CATALOGUE SYNC COMPLETE</small><strong>{shopifySyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{shopifyConnected && <button className="danger-button" disabled={savingConnection} onClick={disconnectShopify}>Disconnect</button>}<button onClick={()=>setShowShopifySetup(false)}>Close</button><button className="primary" disabled={savingConnection || (!shopifyConnected && (!shopDomain.trim() || !shopifyToken.trim()))} onClick={saveShopify}>{savingConnection?"Importing Shopify orders…":shopifyConnected?(shopifyToken.trim()?"Reconnect & sync":"Retry order import"):"Connect & import"}</button></div>
    </section></div>}
    {showMetaSetup && <div className="modal-backdrop" onMouseDown={()=>setShowMetaSetup(false)}><section className="connection-modal" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="modal-close" onClick={()=>setShowMetaSetup(false)}><X/></button>
      <div className="modal-brand">{integrationLogo("Meta Ads")}<div><span className="eyebrow">DATA CONNECTION</span><h2>Connect Meta Ads</h2></div></div>
      <p className="modal-intro">Connect with Facebook to grant Spine read-only access to your Meta Ads account. There is no Graph API Explorer token to copy and your Facebook password never reaches Spine.</p>
      <div className="connection-notice meta-oauth-notice"><Info/><div><strong>Connect your own Facebook account</strong><span>Choose the Meta ad account you manage, then Spine securely saves the approved connection and imports its daily spend.</span></div><button className="primary" disabled={savingConnection} onClick={connectMetaWithFacebook}><ExternalLink/>{metaConnectionStatus === "error" ? "Reconnect Facebook" : "Connect Facebook"}</button></div>
      {metaConnectionStatus === "error" && metaConnectionError && <div className="connection-error" role="alert">{metaConnectionError}</div>}
      {metaConnected && metaAccountName && <div className="connected-account"><span/><div><small>CURRENT ACCOUNT</small><strong>{metaAccountName}</strong>{metaLastSync ? <small>{metaLastSync.importedDays.toLocaleString()} daily spend records · latest {metaLastSync.latestDate ? new Date(`${metaLastSync.latestDate}T00:00:00Z`).toLocaleDateString("en-GB") : "date unavailable"}</small> : <small>Spend data has not been imported yet.</small>}</div></div>}
      <div className="help-card"><Info/><div><strong>Alternative for agency-managed accounts</strong><p>Use a Meta system-user token only if your business manages the connection centrally. For normal use, choose <b>Connect Facebook</b> above.</p><a className="meta-developer-link" href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer"><ExternalLink/>Open Graph API Explorer</a></div></div>
      <label className="form-field"><span>System-user token <small>Optional alternative</small><b className="tooltip-trigger">?<em>Use this only for a centrally managed Meta system user with ads_read and read_insights.</em></b></span><div className="secret-input"><KeyRound/><input value={token} onChange={(event)=>{setToken(event.target.value);setMetaAccounts([]);setAccountId("");setMetaAccountSearch("");setConnectionError("");}} type={showToken?"text":"password"} placeholder="EAAB..." autoComplete="off"/><button onClick={()=>setShowToken(!showToken)}>{showToken?<EyeOff/>:<Eye/>}</button></div></label>
      <div className="meta-account-discovery"><button type="button" disabled={!token.trim() || loadingMetaAccounts} onClick={() => void loadMetaAccounts()}>{loadingMetaAccounts ? "Loading accounts…" : metaAccounts.length ? "Reload ad accounts" : "Find ad accounts"}</button><small>{metaAccounts.length ? `${metaAccounts.length} account${metaAccounts.length === 1 ? "" : "s"} available to this token.` : "Enter your token, then load the ad accounts it can access."}</small></div>
      <label className="form-field"><span>Search Meta ad accounts</span><div className="meta-account-search"><Search aria-hidden="true"/><input type="search" value={metaAccountSearch} onChange={(event) => setMetaAccountSearch(event.target.value)} placeholder={metaAccounts.length ? "Filter by account name, currency or ID" : "Load accounts to search"} disabled={!metaAccounts.length} /></div></label>
      <div className="meta-account-results" role="listbox" aria-label="Meta ad accounts" aria-disabled={!metaAccounts.length}>
        {!metaAccounts.length ? <span className="meta-account-empty">Load accounts to choose an ad account.</span> : filteredMetaAccounts.length ? filteredMetaAccounts.map((account) => {
          const id = account.id.startsWith("act_") ? account.id : `act_${account.id}`;
          return <button type="button" role="option" aria-selected={accountId === account.id} className={accountId === account.id ? "selected" : ""} key={account.id} onClick={() => setAccountId(account.id)}>
            <span>{account.name}</span><small>{account.currency ? `${account.currency} · ` : ""}{id}</small>
          </button>;
        }) : <span className="meta-account-empty">No accounts match “{metaAccountSearch}”.</span>}
      </div>
      {accountId && <div className="meta-account-selection"><strong>Selected account</strong><span>{metaAccounts.find((account) => account.id === accountId)?.name ?? accountId}</span></div>}
      <label className="form-field"><span>Spend history to import</span><select value={metaLookbackMonths} onChange={(event)=>setMetaLookbackMonths(event.target.value)}><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="24">Last 24 months</option><option value="36">Last 36 months</option></select><small>New connections default to the last 365 days. Meta supports up to 37 months when you need more history.</small></label>
      <div className="permission-note"><KeyRound/><span><strong>Required permissions:</strong> ads_read, read_insights</span></div>
      {metaSyncResult && <div className="connected-account"><span/><div><small>SPEND IMPORT COMPLETE</small><strong>{metaSyncResult}</strong></div></div>}{connectionError && <div className="connection-error">{connectionError}</div>}
      <div className="modal-actions">{metaConnected&&<button className="danger-button" disabled={savingConnection} onClick={disconnectMeta}>Disconnect</button>}<button onClick={()=>setShowMetaSetup(false)}>Cancel</button><button className="primary" disabled={!token.trim() || !accountId || savingConnection} onClick={saveMeta}>{savingConnection?"Importing…":metaConnected?"Save manual token":"Save manual token"}</button></div>
    </section></div>}
    {showGhlSetup && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingConnection) setShowGhlSetup(false); }}><section className="connection-modal ghl-connection-modal" role="dialog" aria-modal="true" aria-labelledby="ghl-connection-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="modal-close" aria-label="Close GoHighLevel connection" onClick={() => !savingConnection && setShowGhlSetup(false)}><X/></button>
      <div className="modal-brand"><div className="source-logo ghl" aria-hidden="true" style={{ backgroundImage: `url("${goHighLevelLogo}")` }} /><div><span className="eyebrow">LEAD GENERATION INTEGRATION</span><h2 id="ghl-connection-title">{ghlConnected ? "Update GoHighLevel" : "Connect GoHighLevel"}</h2></div></div>
      <p className="modal-intro">Add the private integration token and the sub-account location it belongs to. The form stays open if you switch browser tabs; the token is only sent when you save.</p>
      {ghlConnected && ghlAccountName && <div className="connected-account"><span/><div><small>CONNECTED LOCATION</small><strong>{ghlAccountName}</strong></div></div>}
      <form onSubmit={(event) => void connectGhl(event)}>
        <label className="form-field" htmlFor="ghl-location-id"><span>GoHighLevel location ID</span><input id="ghl-location-id" value={ghlLocationId} onChange={(event) => setGhlLocationId(event.target.value)} placeholder="Sub-account location ID" autoComplete="off" required /></label>
        <label className="form-field" htmlFor="ghl-private-token"><span>Private integration token</span><div className="secret-input"><KeyRound/><input id="ghl-private-token" value={ghlApiKey} onChange={(event) => setGhlApiKey(event.target.value)} type={showGhlToken ? "text" : "password"} placeholder="Paste your private integration token" autoComplete="off" required /><button type="button" aria-label={showGhlToken ? "Hide token" : "Show token"} onClick={() => setShowGhlToken(!showGhlToken)}>{showGhlToken ? <EyeOff/> : <Eye/>}</button></div><small>Use a private integration token with read access to locations, contacts and opportunities.</small></label>
        <div className="cost-form-grid ghl-form-grid">
          <label className="form-field" htmlFor="ghl-source-type"><span>Data to report</span><select id="ghl-source-type" value={ghlSourceType} onChange={(event) => { const source = event.target.value as "opportunities" | "contacts"; setGhlSourceType(source); setGhlMetricLabel(source === "opportunities" ? "Booked calls" : "Qualified leads"); }}><option value="opportunities">Pipeline opportunities</option><option value="contacts">Contacts / leads</option></select></label>
          <label className="form-field" htmlFor="ghl-metric-label"><span>Cost per event label</span><input id="ghl-metric-label" value={ghlMetricLabel} onChange={(event) => setGhlMetricLabel(event.target.value)} placeholder="Booked calls" maxLength={80} required /></label>
        </div>
        <div className="permission-note"><KeyRound/><span>Your token is encrypted in secure storage and is never shown again after saving.</span></div>
        {connectionError && <div className="connection-error" role="alert">{connectionError}</div>}
        <div className="modal-actions">{ghlConnected && <button type="button" className="danger-button" disabled={savingConnection} onClick={async () => { setSavingConnection(true); setConnectionError(""); try { const response = await fetch("/api/connections/gohighlevel", { method: "DELETE" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Could not disconnect GoHighLevel"); setGhlConnected(false); setGhlAccountName(""); setGhlApiKey(""); setGhlLocationId(""); setShowGhlSetup(false); } catch (reason) { setConnectionError(reason instanceof Error ? reason.message : "Could not disconnect GoHighLevel"); } finally { setSavingConnection(false); } }}>Disconnect</button>}<button type="button" disabled={savingConnection} onClick={() => setShowGhlSetup(false)}>Cancel</button><button className="primary" type="submit" disabled={savingConnection || !ghlApiKey.trim() || !ghlLocationId.trim() || !ghlMetricLabel.trim()}>{savingConnection ? "Validating and saving…" : ghlConnected ? "Save connection" : "Connect GoHighLevel"}</button></div>
      </form>
    </section></div>}
  </>;
}
