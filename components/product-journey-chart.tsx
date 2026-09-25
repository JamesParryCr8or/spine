"use client";

import { useState } from "react";

type JourneyPath = { depth: number; products: string[]; customers: number };
type Props = {
  paths: JourneyPath[];
  countsByDepth: Array<{ depth: number; customers: number }>;
};
type Node = { name: string; count: number; y: number; height: number; incoming: number; outgoing: number };
const colors = ["#7660ed", "#25a8da", "#ed8d64", "#25b59b", "#ce75d6", "#d4ad41", "#617ebd", "#de7297"];
const orderNames = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
const shortName = (name: string) => name.length > 25 ? name.slice(0, 24) + "…" : name;

export function ProductJourneyChart({ paths, countsByDepth }: Props) {
  const [depth, setDepth] = useState(2);
  const [limit, setLimit] = useState(12);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const available = paths.filter((path) => path.depth === depth && path.customers > 0).sort((a, b) => b.customers - a.customers);
  const shown = available.slice(0, limit);
  const totalShown = shown.reduce((sum, path) => sum + path.customers, 0);
  const eligibleCustomers = countsByDepth.find((row) => row.depth === depth)?.customers ?? totalShown;
  const width = depth === 2 ? 900 : depth * 350 + 140;
  const columnX = (index: number) => 240 + index * (width - 480) / (depth - 1);
  const columns = Array.from({ length: depth }, (_, layer) => {
    const counts = new Map<string, number>();
    for (const path of shown) counts.set(path.products[layer], (counts.get(path.products[layer]) ?? 0) + path.customers);
    const ordered = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return ordered.map(([name, count]) => ({ name, count, y: 0, height: 0, incoming: 0, outgoing: 0 }));
  });
  const plotHeight = Math.max(430, ...columns.map((nodes) => nodes.length * 49));
  for (const nodes of columns) {
    const availableHeight = plotHeight - Math.max(0, nodes.length - 1) * 17;
    let top = 48;
    for (const node of nodes) {
      node.height = totalShown ? node.count / totalShown * availableHeight : 0;
      node.y = top;
      top += node.height + 17;
    }
  }
  const links: Array<{ path: string; color: string; index: number }> = [];
  shown.forEach((journey, index) => {
    for (let layer = 0; layer < depth - 1; layer += 1) {
      const source = columns[layer].find((node) => node.name === journey.products[layer])!;
      const target = columns[layer + 1].find((node) => node.name === journey.products[layer + 1])!;
      const sourceHeight = source.height * journey.customers / source.count;
      const targetHeight = target.height * journey.customers / target.count;
      const x1 = columnX(layer) + 14;
      const x2 = columnX(layer + 1);
      const bend1 = x1 + (x2 - x1) * .42;
      const bend2 = x1 + (x2 - x1) * .58;
      const y1 = source.y + source.outgoing;
      const y2 = target.y + target.incoming;
      source.outgoing += sourceHeight;
      target.incoming += targetHeight;
      links.push({
        index,
        color: colors[columns[0].indexOf(columns[0].find((node) => node.name === journey.products[0])!) % colors.length],
        path: "M " + x1 + " " + y1 + " C " + bend1 + " " + y1 + ", " + bend2 + " " + y2 + ", " + x2 + " " + y2 +
          " L " + x2 + " " + (y2 + targetHeight) + " C " + bend2 + " " + (y2 + targetHeight) + ", " + bend1 + " " + (y1 + sourceHeight) + ", " + x1 + " " + (y1 + sourceHeight) + " Z",
      });
    }
  });
  const selected = active === null ? null : shown[active];
  return <div className="customer-viz">
    <div className="customer-viz-toolbar">
      <div className="customer-viz-legend"><span><i style={{ background: colors[0] }}/>Width represents customers</span></div>
      <div>
        <label>Order depth <select value={depth} onChange={(event) => { setDepth(Number(event.target.value)); setActive(null); }}>
          {[2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>Through {orderNames[value].toLowerCase()} order</option>)}
        </select></label>
        <label>Paths <select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setActive(null); }}>
          <option value={8}>Top 8</option><option value={12}>Top 12</option><option value={20}>Top 20</option>
        </select></label>
        <button type="button" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>{showTable ? "Show graph" : "View chart data"}</button>
      </div>
    </div>
    {shown.length === 0 ? <p className="customer-viz-empty">No customers with {depth} product-bearing orders in this period.</p> : showTable ?
      <div className="table-scroll"><table className="data-table"><thead><tr>{Array.from({ length: depth }, (_, index) => <th key={index}>{orderNames[index + 1]} order</th>)}<th>Customers</th></tr></thead>
        <tbody>{shown.map((row, index) => <tr key={index}>{row.products.map((product, layer) => <td key={layer}>{product}</td>)}<td>{row.customers.toLocaleString()}</td></tr>)}</tbody></table></div> :
      <>
        <div className="customer-viz-scroll"><svg viewBox={"0 0 " + width + " " + (plotHeight + 90)} className="customer-journey-svg" style={{ minWidth: width }} role="img" aria-label={"Product journeys through " + orderNames[depth].toLowerCase() + " order"}>
          {columns.map((nodes, layer) => <text key={"heading-" + layer} x={columnX(layer) + 7} y="24" textAnchor="middle" className="customer-viz-heading">{orderNames[layer + 1].toUpperCase()} ORDER</text>)}
          {links.map((link, linkIndex) => <path key={linkIndex} d={link.path} fill={link.color} opacity={active === null ? .32 : active === link.index ? .8 : .07}
            tabIndex={0} role="button" aria-label={shown[link.index].products.join(" to ") + ": " + shown[link.index].customers + " customers"}
            onMouseEnter={() => setActive(link.index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(link.index)} onBlur={() => setActive(null)} onClick={() => setActive(link.index)}>
            <title>{shown[link.index].products.join(" → ") + ": " + shown[link.index].customers + " customers"}</title>
          </path>)}
          {columns.flatMap((nodes, layer) => nodes.map((node, index) => <g key={layer + "-" + node.name}>
            <rect x={columnX(layer)} y={node.y} width="14" height={node.height} rx="4" fill={colors[index % colors.length]}/>
            <text x={layer === 0 ? columnX(layer) - 12 : columnX(layer) + 25} y={node.y + node.height / 2 - 2} textAnchor={layer === 0 ? "end" : "start"} className="customer-viz-label">
              <title>{node.name}</title>{shortName(node.name)}
              <tspan x={layer === 0 ? columnX(layer) - 12 : columnX(layer) + 25} dy="16" fill="#8791a7">{node.count.toLocaleString()} customers</tspan>
            </text>
          </g>))}
        </svg></div>
        <div className="customer-viz-detail" aria-live="polite">{selected ? <><strong>{selected.products.join(" → ")}</strong><span>{selected.customers.toLocaleString()} customers · {((selected.customers / Math.max(1, eligibleCustomers)) * 100).toFixed(1)}% of customers reaching order {depth}</span></> : <span>Hover over or select a path to see its full product sequence.</span>}</div>
      </>}
    <p className="report-note">Showing {shown.length} of {available.length} paths through order {depth}. Each customer contributes one sequence using the first product in each order. {eligibleCustomers.toLocaleString()} customers reached this order.</p>
  </div>;
}
