"use client";

import { useState } from "react";

type Location = { country: string; orders: number; customers: number; sales: number };
type Props = { locations: Location[]; currency: string };
const points: Record<string, [number, number]> = {
  "United Kingdom": [54, -2], "Germany": [51, 10], "France": [47, 2], "Italy": [42, 12],
  "Spain": [40, -4], "Poland": [52, 20], "Netherlands": [52, 5], "Belgium": [51, 4],
  "Switzerland": [47, 8], "Austria": [48, 14], "Ireland": [53, -8], "Portugal": [39, -8],
  "Sweden": [63, 16], "Norway": [62, 10], "Denmark": [56, 10], "Finland": [64, 26],
  "Iceland": [65, -19], "Luxembourg": [50, 6], "Andorra": [43, 2], "Serbia": [44, 21],
  "Greece": [39, 23], "Romania": [46, 25], "Czechia": [50, 15], "Czech Republic": [50, 15],
  "Hungary": [47, 19], "Turkey": [39, 35], "Ukraine": [49, 32], "Russia": [61, 100],
  "United States": [39, -98], "United States of America": [39, -98], "Canada": [57, -106],
  "Mexico": [24, -102], "Brazil": [-10, -52], "Argentina": [-35, -64], "Chile": [-33, -71],
  "Colombia": [4, -74], "Peru": [-10, -76], "South Africa": [-29, 25], "Nigeria": [9, 8],
  "Egypt": [27, 30], "Morocco": [32, -6], "Kenya": [0, 38], "India": [22, 79],
  "China": [35, 104], "Japan": [37, 138], "South Korea": [36, 128], "Singapore": [1, 104],
  "Malaysia": [4, 102], "Thailand": [15, 101], "Indonesia": [-2, 118], "Philippines": [13, 122],
  "Australia": [-25, 134], "New Zealand": [-41, 174], "United Arab Emirates": [24, 54],
  "Saudi Arabia": [24, 45], "Israel": [31, 35], "Pakistan": [30, 69], "Bangladesh": [24, 90],
};
const colors = ["#6657e8", "#26a4db", "#18ae91", "#f3a426", "#ed797a", "#9d71df", "#4f87be"];
const money = (currency: string, value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);
function project(lat: number, lon: number, center: number) {
  const phi = lat * Math.PI / 180;
  const lambda = (lon - center) * Math.PI / 180;
  const visibility = Math.cos(phi) * Math.cos(lambda);
  if (visibility <= 0) return null;
  return { x: 200 + 166 * Math.cos(phi) * Math.sin(lambda), y: 200 - 166 * Math.sin(phi), visibility };
}

export function CustomerGeography({ locations, currency }: Props) {
  const [center, setCenter] = useState(10);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<"sales" | "customers" | "orders">("sales");
  const ranked = [...locations].filter((row) => row.sales > 0).sort((a, b) => b[sort] - a[sort]);
  const total = ranked.reduce((sum, row) => sum + row.sales, 0);
  const max = Math.max(1, ...ranked.map((row) => row.sales));
  const active = ranked.find((row) => row.country === selected) ?? ranked[0];
  const top = [...ranked].sort((a, b) => b.sales - a.sales).slice(0, 6);
  const other = Math.max(0, total - top.reduce((sum, row) => sum + row.sales, 0));
  const slices = [...top.map((row, index) => ({ label: row.country, value: row.sales, color: colors[index % colors.length] })), ...(other ? [{ label: "Other countries", value: other, color: "#e1e5ef" }] : [])];
  let progress = 0;
  const gradient = slices.map((slice) => {
    const start = progress;
    progress += total ? slice.value / total * 100 : 0;
    return slice.color + " " + start + "% " + progress + "%";
  }).join(", ");
  return <div className="geography-report">
    <div className="geography-layout">
      <section className="geography-globe-card">
        <div className="geography-card-head"><div><span className="eyebrow">SALES GEOGRAPHY</span><h3>Explore customer locations</h3><p>Hover over a country marker for its sales, customers and orders.</p></div>
          <label>Globe view <select value={center} onChange={(event) => setCenter(Number(event.target.value))}>
            <option value={10}>Europe & Africa</option><option value={-100}>Americas</option><option value={110}>Asia Pacific</option>
          </select></label></div>
        <div className="geography-globe-wrap"><svg viewBox="0 0 400 400" className="geography-globe" role="img" aria-label="Interactive globe showing countries with Shopify sales">
          <defs><radialGradient id="globe-sea" cx="32%" cy="27%" r="76%"><stop stopColor="#edf3ff"/><stop offset="1" stopColor="#d7e0fa"/></radialGradient><clipPath id="globe-clip"><circle cx="200" cy="200" r="174"/></clipPath></defs>
          <circle cx="200" cy="200" r="174" fill="url(#globe-sea)" stroke="#cbd6f1" strokeWidth="2"/>
          <g clipPath="url(#globe-clip)" fill="none" stroke="#b7c5e8" strokeWidth="1" opacity=".7">
            {[80, 120, 160, 200, 240, 280, 320].map((y) => <ellipse key={y} cx="200" cy={y} rx={Math.sqrt(Math.max(0, 174 * 174 - (y - 200) * (y - 200)))} ry="8"/>)}
            <ellipse cx="200" cy="200" rx="60" ry="174"/><ellipse cx="200" cy="200" rx="120" ry="174"/>
            <path d="M 26 200 H 374"/>
          </g>
          {ranked.map((row) => {
            const coords = points[row.country];
            const point = coords && project(coords[0], coords[1], center);
            if (!point) return null;
            const radius = 5 + Math.sqrt(row.sales / Math.max(1, max)) * 13;
            return <g key={row.country} className="geography-point" tabIndex={0} role="button" aria-label={row.country + ": " + money(currency, row.sales) + " sales"} onMouseEnter={() => setSelected(row.country)} onFocus={() => setSelected(row.country)} onClick={() => setSelected(row.country)}>
              <circle cx={point.x} cy={point.y} r={radius + 5} fill="#6657e8" opacity=".13"/>
              <circle cx={point.x} cy={point.y} r={radius} fill={selected === row.country ? "#23b09c" : "#6657e8"} opacity=".85" stroke="white" strokeWidth="2"/>
              <title>{row.country + ": " + money(currency, row.sales) + ", " + count(row.customers) + " customers, " + count(row.orders) + " orders"}</title>
            </g>;
          })}
        </svg></div>
        {active && <div className="geography-selected"><strong>{active.country}</strong><span>{money(currency, active.sales)} sales</span><small>{count(active.customers)} customers · {count(active.orders)} orders</small></div>}
        <p className="report-note">Markers show approximate country centres. Switch globe view to see the other side; every country is listed below.</p>
      </section>
      <section className="geography-pie-card"><span className="eyebrow">COUNTRY MIX</span><h3>Share of sales</h3>
        <div className="geography-donut" style={{ background: "conic-gradient(" + (gradient || "#e1e5ef 0% 100%") + ")" }}><div><strong>{count(ranked.length)}</strong><span>countries</span></div></div>
        <div className="geography-pie-legend">{slices.map((slice) => <button key={slice.label} type="button" onMouseEnter={() => setSelected(slice.label)} onFocus={() => setSelected(slice.label)} onClick={() => setSelected(slice.label)}><i style={{ background: slice.color }}/><span>{slice.label}</span><strong>{total ? (slice.value / total * 100).toFixed(1) : "0.0"}%</strong></button>)}</div>
      </section>
    </div>
    <section className="geography-table-card"><div className="geography-card-head"><div><span className="eyebrow">ALL COUNTRIES</span><h3>Sales by country</h3></div><label>Rank by <select value={sort} onChange={(event) => setSort(event.target.value as "sales" | "customers" | "orders")}><option value="sales">Sales</option><option value="customers">Customers</option><option value="orders">Orders</option></select></label></div>
      <div className="table-scroll"><table className="data-table geography-table"><thead><tr><th>Country</th><th>Sales in period</th><th>Customers</th><th>Orders</th><th>Sales share</th></tr></thead><tbody>{ranked.map((row, index) => <tr key={row.country} onMouseEnter={() => setSelected(row.country)} onClick={() => setSelected(row.country)} className={selected === row.country ? "selected" : ""}><td><strong>{index + 1}. {row.country || "Unknown"}</strong></td><td><div className="geography-bar-cell"><span style={{ width: Math.max(2, row.sales / max * 100) + "%" }}/><strong>{money(currency, row.sales)}</strong></div></td><td>{count(row.customers)}</td><td>{count(row.orders)}</td><td>{total ? (row.sales / total * 100).toFixed(1) : "0.0"}%</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
