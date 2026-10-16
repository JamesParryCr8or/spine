"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FilePlus2, RefreshCw } from "lucide-react";
import { combinedDemand, defaultPlanning, planStock, type PlanningSettings, type PurchaseOrder, type StockDemand, type StockItem } from "@/lib/stock/planning";
import { StockPurchaseOrder, downloadStockCsv } from "@/components/stock-purchase-order";
import styles from "./stock.module.css";

type DemandResponse = { demand: StockDemand[]; asOf: string; storeName: string; currency: string; canManage: boolean; through: string; source: "shopifyql" };
type StockPage = { items: StockItem[]; nextCursor: string | null; fetchedAt: string };
type StockView = "Stock report" | "Replenishment" | "Purchase orders";
async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load stock data");
  return data as T;
}
export function Stock({ storeId, view }: { storeId: string; view: StockView }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [demand, setDemand] = useState<DemandResponse | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [drafts, setDrafts] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [poError, setPoError] = useState("");
  const [reload, setReload] = useState(0);
  const [fetchedAt, setFetchedAt] = useState("");
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [vendor, setVendor] = useState("");
  const [action, setAction] = useState("");
  const [sort, setSort] = useState("cover");
  const [page, setPage] = useState(0);
  const [settings, setSettings] = useState<PlanningSettings>(defaultPlanning);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      setLoading(true); setError(""); setPoError(""); setItems([]); setDemand(null); setSelected(new Set());
      const base = `/api/stock?storeId=${encodeURIComponent(storeId)}`;
      const demandPromise = getJson<DemandResponse>(`${base}&part=demand`, signal);
      const inventoryPromise = (async () => {
        let cursor: string | null = null;
        const collected = new Map<string, StockItem>();
        const cursors = new Set<string>();
        do {
          const result: StockPage = await getJson<StockPage>(`${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal);
          result.items.forEach((item) => collected.set(item.id, item));
          if (signal.aborted) return;
          setItems([...collected.values()]); setFetchedAt(result.fetchedAt);
          cursor = result.nextCursor;
          if (cursor && cursors.has(cursor)) throw new Error("Shopify repeated a stock page. Refresh to retry.");
          if (cursor) cursors.add(cursor);
        } while (cursor);
      })();
      const results = await Promise.allSettled([demandPromise, inventoryPromise]);
      if (signal.aborted) return;
      if (results[0].status === "fulfilled") setDemand(results[0].value);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") setError(failure.reason instanceof Error ? failure.reason.message : "Could not load stock");
      setLoading(false);
    })();
    void getJson<{ orders: PurchaseOrder[] }>(`/api/stock/purchase-orders?storeId=${encodeURIComponent(storeId)}`, signal).then((data) => { if (!signal.aborted) setOrders(data.orders); }).catch((err) => { if (!signal.aborted) setPoError(err instanceof Error ? err.message : "Could not load purchase orders"); });
    return () => controller.abort();
  }, [storeId, reload]);

  const locations = useMemo(() => [...new Map(items.flatMap((item) => item.levels.filter((level) => level.active).map((level) => [level.id, level.name] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items]);
  const vendors = useMemo(() => [...new Set(items.map((item) => item.vendor).filter(Boolean))].sort(), [items]);
  const demandMap = useMemo(() => new Map(demand?.demand.map((row) => [row.variantId, row]) ?? []), [demand]);
  const planned = useMemo(() => items.map((item) => { const combined = combinedDemand(item, demandMap); return { item, demand: combined, plan: planStock(item, combined, warehouse, settings) }; }), [items, demandMap, warehouse, settings]);
  const rows = useMemo(() => planned.filter(({ item, plan }) => (!warehouse || item.levels.some((level) => level.id === warehouse && level.active)) && (!status || item.status === status) && (!tag || item.tags.includes(tag)) && (!vendor || item.vendor === vendor) && (!action || plan.action === action) && (!search || `${item.title} ${item.variant} ${item.sku}`.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => sort === "title" ? a.item.title.localeCompare(b.item.title) : sort === "available" ? a.plan.available - b.plan.available : sort === "reorder" ? b.plan.reorder - a.plan.reorder : (a.plan.stockDays ?? Infinity) - (b.plan.stockDays ?? Infinity)), [planned, warehouse, status, tag, vendor, action, search, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * 50, currentPage * 50 + 50);
  const ready = !loading && !error && !!demand;
  const canDraft = ready;
  const updateSettings = (key: keyof PlanningSettings, value: number | boolean) => { setSettings((old) => ({ ...old, [key]: value })); setPage(0); };
  const draftOrders = (onlySelected: boolean) => {
    if (!canDraft || !demand) return;
    const candidates = rows.filter((row) => onlySelected ? selected.has(row.item.id) && row.item.tracked : row.plan.reorder > 0 && row.item.status === "ACTIVE");
    const grouped = new Map<string, typeof candidates>();
    candidates.forEach((row) => { const key = `${row.item.vendor}\0${row.item.currency ?? demand.currency}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); });
    const date = new Date().toISOString().slice(0, 10);
    setDrafts([...grouped.values()].map((group, index) => ({ id: "", reference: `PO-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}-${index + 1}`, supplier: group[0].item.vendor, warehouse: locations.find(([id]) => id === warehouse)?.[1] ?? "", currency: group[0].item.currency ?? demand.currency, expected_date: new Date(Date.now() + settings.lead * 86400000).toISOString().slice(0, 10), notes: "", created_at: new Date().toISOString(), lines: group.map(({ item, plan }) => ({ variantId: item.variantId, sku: item.sku, title: item.title, variant: item.variant, image: item.image, quantity: plan.reorder || 1, unitCost: item.unitCost })) })));
  };
  const exportReport = () => downloadStockCsv(`stock-${warehouse ? "warehouse" : "all"}-${new Date().toISOString().slice(0, 10)}.csv`, [
    ["SKU", "Product", "Variant", "Vendor", "Status", "Tags", "Warehouse", "Available", "On hand", "Committed", "Incoming", "30d sales", "60d sales", "90d sales", "30d reversed units", "60d reversed units", "90d reversed units", "30d net units", "60d net units", "90d net units", "Demand window", "Warehouse demand share %", "Daily units", "Days of stock", "Action", "Suggested reorder", "Snapshot time"],
    ...rows.map(({ item, demand: d, plan }) => [item.sku, item.title, item.variant, item.vendor, item.status, item.tags.join("; "), locations.find(([id]) => id === warehouse)?.[1] ?? "All active warehouses", plan.available, plan.onHand, plan.committed, plan.incoming, d?.sales30 ?? 0, d?.sales60 ?? 0, d?.sales90 ?? 0, d?.returns30 ?? 0, d?.returns60 ?? 0, d?.returns90 ?? 0, d?.net30 ?? 0, d?.net60 ?? 0, d?.net90 ?? 0, settings.days, warehouse ? settings.share : 100, Number(plan.daily.toFixed(3)), plan.stockDays === null ? "No demand" : Number(plan.stockDays.toFixed(1)), plan.action, plan.reorder, fetchedAt]),
  ]);
  const onSaved = (order: PurchaseOrder) => setOrders((old) => [order, ...old.filter((o) => o.id !== order.id)]);
  return <div className={styles.root}>
    <div className={styles.heading}><div><span className="eyebrow">INVENTORY & PURCHASING</span><h2>{view}</h2><p>Plan stock, spot shortages and prepare supplier orders.</p></div><div className={styles.actions}><button disabled={loading} onClick={() => setReload((n) => n + 1)}><RefreshCw size={16}/>Refresh stock</button>{view !== "Purchase orders" && <button disabled={!ready} onClick={exportReport}><Download size={16}/>Export report</button>}</div></div>
    <nav className={styles.tabs} aria-label="Stock reports">{(["Stock report", "Replenishment", "Purchase orders"] as StockView[]).map((name) => <Link key={name} href={`/protected/${name.toLowerCase().replaceAll(" ", "-")}`} aria-current={view === name ? "page" : undefined}>{name}</Link>)}</nav>
    {view === "Purchase orders" ? <>
      <div className={styles.notice}>Saved supplier drafts. These are exportable planning documents; incoming inventory comes from Shopify. Create new orders from Replenishment.</div>
      {poError && <p role="alert" className={styles.error}>{poError}</p>}
      {orders.length === 0 ? <div className={styles.empty}>{loading ? "Loading purchase orders…" : "No purchase orders saved yet. Open Replenishment to review suggestions."}</div> : orders.map((po) => <StockPurchaseOrder key={po.id} initial={po} storeId={storeId} storeName={demand?.storeName ?? "Spine"} destinations={locations.map((l) => l[1])} canManage={false} onSaved={onSaved}/>)}
    </> : <>
      {loading && <div role="status" className={styles.loading}><span className={styles.spinner}/>Loading live inventory… {items.length.toLocaleString()} variants loaded. Suggestions unlock after all pages finish.</div>}
      {error && <div role="alert" className={styles.error}>{error} Partial results are shown for reference. Refresh to retry.</div>}
      {demand && <div className={styles.notice}>
        Inventory snapshot: {fetchedAt ? new Date(fetchedAt).toLocaleString("en-GB") : "Loading"}. ShopifyQL demand: complete days through {demand.through}, fetched {new Date(demand.asOf).toLocaleString("en-GB")}.
      </div>}
      <div className={styles.cards}>{[["Available units", rows.reduce((sum, row) => sum + row.plan.available, 0).toLocaleString()], ["Need replenishment", rows.filter((row) => row.plan.reorder > 0).length.toLocaleString()], ["Out of stock", rows.filter((row) => row.item.tracked && row.plan.available <= 0).length.toLocaleString()], ["Incoming units", rows.reduce((sum, row) => sum + row.plan.incoming, 0).toLocaleString()]].map(([label, value]) => <div key={label} className={styles.card}><small>{label} · filtered</small><strong>{value}</strong></div>)}</div>
      <div className={styles.filters}>
        <label>Find product / SKU<input type="search" value={search} placeholder="Search products…" onChange={(e) => { setSearch(e.target.value); setPage(0); }}/></label>
        <label>Warehouse<select value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setSelected(new Set()); setPage(0); }}><option value="">All active warehouses</option>{locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Product tag<select value={tag} onChange={(e) => { setTag(e.target.value); setPage(0); }}><option value="">All tags</option>{tags.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Product status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{[...new Set(["ACTIVE", "DRAFT", "ARCHIVED", ...items.map((item) => item.status)])].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></label>
        <label>Vendor / supplier<select value={vendor} onChange={(e) => { setVendor(e.target.value); setPage(0); }}><option value="">All suppliers</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Stock health<select value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}><option value="">All stock</option>{["Out of stock", "Reorder", "Monitor", "Healthy", "No recent demand", "Untracked"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Sort<select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}><option value="cover">Lowest coverage</option><option value="reorder">Largest reorder</option><option value="available">Lowest stock</option><option value="title">Product A–Z</option></select></label>
      </div>
      <div className={styles.settings}>
        <label>Sales window<select value={settings.days} onChange={(e) => updateSettings("days", Number(e.target.value))}>{[30, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
        {([ ["lead", "Lead time (days)", 0, 365], ["cover", "Cover after arrival", 1, 365], ["safety", "Safety stock (days)", 0, 365], ["pack", "Case pack (units)", 1, 10000], ["minimum", "Minimum order", 0, 1000000], ...(warehouse ? [["share", "Warehouse demand %", 0, 100]] : []) ] as [keyof PlanningSettings, string, number, number][]).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} step={1} value={Number(settings[key])} onChange={(e) => updateSettings(key, Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0))))}/></label>)}
        <label><span>Incoming inventory</span><span><input type="checkbox" checked={settings.incoming} onChange={(e) => updateSettings("incoming", e.target.checked)}/> Deduct from reorder</span></label>
      </div>
      <div className={styles.notice}>Demand comes directly from Shopify Analytics for the last 30, 60 and 90 complete days, by event date. Reversals include refunds, returns, cancellations and order edits; they are not a count of physical returns. Shopify analytics processing may lag recent activity. {warehouse ? `This warehouse is allocated ${settings.share}% of store demand; adjust its share above.` : "All active warehouse stock is combined once per variant."} Reorder when available + included incoming falls below lead time + safety stock; top up to lead time + safety + coverage. Incoming arrival dates are unknown, so check expected deliveries before ordering.</div>
      {view === "Replenishment" && <div className={styles.actions}><button className={styles.primary} disabled={!canDraft || !rows.some((r) => r.plan.reorder > 0 && r.item.status === "ACTIVE")} onClick={() => draftOrders(false)}><FilePlus2 size={16}/>Generate suggested POs</button><button disabled={!canDraft || !rows.some((r) => selected.has(r.item.id) && r.item.tracked)} onClick={() => draftOrders(true)}>Review selected products</button><small>Grouped by Shopify vendor and currency. Quantities and suppliers are editable before export.</small></div>}
      <div className={styles.scroll}><table><thead><tr>{view === "Replenishment" && <th><input type="checkbox" aria-label="Select visible tracked products" checked={pageRows.some((r) => r.item.tracked) && pageRows.filter((r) => r.item.tracked).every((r) => selected.has(r.item.id))} onChange={(e) => setSelected((old) => { const next = new Set(old); pageRows.filter((r) => r.item.tracked).forEach((r) => e.target.checked ? next.add(r.item.id) : next.delete(r.item.id)); return next; })}/></th>}<th>Product</th><th>SKU</th><th>Status</th><th>Available</th><th>On hand</th><th>Committed</th><th>Incoming</th><th>Sales 30 / 60 / 90d</th><th>Reversals 30 / 60 / 90d</th><th>Net 30 / 60 / 90d</th><th>Daily demand</th><th>Stock days</th><th>Action</th><th>Reorder</th></tr></thead><tbody>
        {pageRows.map(({ item, demand: d, plan }) => <tr key={item.id}>{view === "Replenishment" && <td><input type="checkbox" aria-label={`Select ${item.title} ${item.variant}`} disabled={!item.tracked} checked={selected.has(item.id)} onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next; })}/></td>}<td><div className={styles.product}>{item.image && <img src={item.image} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer"/>}<span><strong>{item.title}</strong><small>{item.variant === "Default Title" ? item.vendor : `${item.variant} · ${item.vendor}`}</small><small>{item.tags.join(" · ")}</small></span></div></td><td>{item.sku || "No SKU"}</td><td>{item.status.toLowerCase()}</td><td><strong>{item.tracked ? plan.available.toLocaleString() : "—"}</strong></td><td>{plan.onHand.toLocaleString()}</td><td>{plan.committed.toLocaleString()}</td><td>{plan.incoming.toLocaleString()}</td><td>{d ? `${d.sales30} / ${d.sales60} / ${d.sales90}` : "0 / 0 / 0"}</td><td>{d ? `${d.returns30} / ${d.returns60} / ${d.returns90}` : "0 / 0 / 0"}</td><td>{d ? `${d.net30} / ${d.net60} / ${d.net90}` : "0 / 0 / 0"}</td><td>{plan.daily.toFixed(2)}</td><td>{!item.tracked ? "—" : plan.stockDays === null ? "No demand" : plan.stockDays.toFixed(1)}</td><td><span className={`${styles.badge} ${["Out of stock", "Reorder"].includes(plan.action) ? styles.urgent : ["Untracked", "No recent demand"].includes(plan.action) ? styles.neutral : ""}`}>{plan.action}</span></td><td><strong>{plan.reorder.toLocaleString()}</strong></td></tr>)}
      </tbody></table>{!rows.length && <div className={styles.empty}>{loading ? "Waiting for stock…" : "No products match these filters."}</div>}</div>
      <div className={styles.pager}><small>{rows.length.toLocaleString()} variants · page {currentPage + 1} of {pageCount}</small><div className={styles.actions}><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
      {view === "Replenishment" && drafts.map((po) => <StockPurchaseOrder key={po.reference} initial={po} storeId={storeId} storeName={demand?.storeName ?? "Spine"} destinations={locations.map((l) => l[1])} canManage={demand?.canManage ?? false} onSaved={onSaved}/>)}
    </>}
  </div>;
}
