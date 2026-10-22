import type { PnlData } from "./shared";

export function WarehouseBreakdown({ data }: { data?: PnlData | null }) {
  if (!data?.warehouseBreakdown) return null;
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: data.currency });
  return <details className="panel report-panel"><summary>Warehouse fulfilment breakdown</summary>
    <p>Costs follow successful fulfilment dates. Postage is charged once per order at each warehouse; picking uses fulfilled units. Monthly storage and admin are prorated daily. These costs are already included in profit.</p>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Warehouse</th><th>Orders dispatched</th><th>Units picked</th><th>Postage</th><th>Picking</th><th>Storage</th><th>Admin</th><th>Coverage</th></tr></thead><tbody>{data.warehouseBreakdown.map((row) => <tr key={row.locationId}><td>{row.name}</td><td>{row.orders.toLocaleString()}</td><td>{row.units.toLocaleString()}</td><td>{money.format(row.postage)}</td><td>{money.format(row.picking)}</td><td>{money.format(row.storage)}</td><td>{money.format(row.admin)}</td><td>{row.missing ? `${row.missing} activity days need rates` : "Configured"}</td></tr>)}</tbody></table></div>
  </details>;
}
