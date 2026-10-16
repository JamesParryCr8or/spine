export type StockItem = {
  id: string; variantId: string; variantIds: string[]; sku: string; title: string; variant: string;
  vendor: string; status: string; tags: string[]; image: string | null; tracked: boolean;
  unitCost: number | null; currency: string | null;
  levels: { id: string; name: string; active: boolean; available: number; onHand: number; committed: number; incoming: number }[];
};
export type StockDemand = { variantId: string; sales30: number; sales60: number; sales90: number; returns30: number; returns60: number; returns90: number; net30: number; net60: number; net90: number };
export type PlanningSettings = { days: 30 | 60 | 90; lead: number; cover: number; safety: number; pack: number; minimum: number; share: number; incoming: boolean };
export const defaultPlanning: PlanningSettings = { days: 30, lead: 14, cover: 60, safety: 7, pack: 1, minimum: 0, share: 100, incoming: true };
export function combinedDemand(item: StockItem, demand: Map<string, StockDemand>): StockDemand | undefined {
  const found = item.variantIds.map((id) => demand.get(id)).filter((row): row is StockDemand => !!row);
  if (!found.length) return undefined;
  return found.reduce((sum, row) => ({ variantId: item.variantId, sales30: sum.sales30 + row.sales30, sales60: sum.sales60 + row.sales60, sales90: sum.sales90 + row.sales90, returns30: sum.returns30 + row.returns30, returns60: sum.returns60 + row.returns60, returns90: sum.returns90 + row.returns90, net30: sum.net30 + row.net30, net60: sum.net60 + row.net60, net90: sum.net90 + row.net90 }), { variantId: item.variantId, sales30: 0, sales60: 0, sales90: 0, returns30: 0, returns60: 0, returns90: 0, net30: 0, net60: 0, net90: 0 });
}
export function planStock(item: StockItem, demand: StockDemand | undefined, warehouse: string, settings: PlanningSettings) {
  const levels = item.levels.filter((level) => level.active && (!warehouse || level.id === warehouse));
  const available = levels.reduce((sum, level) => sum + level.available, 0);
  const incoming = levels.reduce((sum, level) => sum + level.incoming, 0);
  const net = demand?.[`net${settings.days}`] ?? 0;
  const daily = Math.max(0, net) / settings.days * (warehouse ? settings.share / 100 : 1);
  const position = available + (settings.incoming ? Math.max(0, incoming) : 0);
  const stockDays = daily > 0 ? Math.max(0, available) / daily : null;
  const target = daily * (settings.lead + settings.cover + settings.safety);
  const needsOrder = item.tracked && levels.length > 0 && daily > 0 && position <= daily * (settings.lead + settings.safety);
  const raw = needsOrder ? Math.max(settings.minimum, Math.ceil(target - position), 0) : 0;
  const reorder = raw > 0 ? Math.ceil(raw / Math.max(1, settings.pack)) * Math.max(1, settings.pack) : 0;
  const action = !item.tracked ? "Untracked" : daily === 0 ? "No recent demand" : available <= 0 ? "Out of stock" : needsOrder ? "Reorder" : stockDays !== null && stockDays < settings.lead + settings.safety + 14 ? "Monitor" : "Healthy";
  return { available, incoming, onHand: levels.reduce((sum, level) => sum + level.onHand, 0), committed: levels.reduce((sum, level) => sum + level.committed, 0), daily, stockDays, reorder, action };
}
export type PurchaseLine = { variantId: string; sku: string; title: string; variant: string; image: string | null; quantity: number; unitCost: number | null };
export type PurchaseOrder = { id: string; reference: string; supplier: string; warehouse: string; currency: string; expected_date: string | null; notes: string; lines: PurchaseLine[]; created_at: string };
export function csvText(rows: (string | number | null)[][]) {
  return "\uFEFF" + rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
}
