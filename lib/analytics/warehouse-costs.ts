export type WarehouseRate = {
  locationId: string; name: string; postage: number; picking: number;
  storage: number; admin: number; from: string; to: string | null;
};
export type WarehouseActivity = { date: string; locationId: string; name: string; orders: number; units: number };
export type WarehouseBreakdown = { locationId: string; name: string; orders: number; units: number; postage: number; picking: number; storage: number; admin: number; missing: number };

/** Calendar-day allocation keeps month totals exact and all report groupings additive. */
export function warehouseCosts(rates: WarehouseRate[], activity: WarehouseActivity[], from: string, to: string) {
  const result = new Map<string, WarehouseBreakdown>();
  const rowFor = (id: string, name: string) => {
    if (!result.has(id)) result.set(id, { locationId: id, name, orders: 0, units: 0, postage: 0, picking: 0, storage: 0, admin: 0, missing: 0 });
    return result.get(id)!;
  };
  for (const event of activity) {
    if (event.date < from || event.date > to) continue;
    const row = rowFor(event.locationId, event.name);
    row.orders += event.orders; row.units += event.units;
    const rate = rates.find((rate) => rate.locationId === event.locationId && rate.from <= event.date && (!rate.to || rate.to >= event.date));
    if (!rate) { row.missing += 1; continue; }
    row.postage += event.orders * rate.postage;
    row.picking += event.units * rate.picking;
  }
  for (const rate of rates) {
    const start = rate.from > from ? rate.from : from;
    const end = rate.to && rate.to < to ? rate.to : to;
    if (start > end) continue;
    const row = rowFor(rate.locationId, rate.name);
    for (let date = new Date(`${start}T00:00:00Z`); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      row.storage += rate.storage / days; row.admin += rate.admin / days;
    }
  }
  return [...result.values()];
}
