"use client";

import { useEffect, useMemo, useState } from "react";

type Location = { country: string; orders: number; customers: number; sales: number };
type Props = { locations: Location[]; currency: string };
type Border = { name: string; code: string; polygons: number[][][][] };
type MapView = "europe" | "world" | "americas" | "asia" | "africa";
const mapBounds: Record<MapView, [number, number, number, number]> = {
  europe: [-14, 42, 34, 72],
  world: [-180, 180, -60, 85],
  americas: [-170, -30, -58, 75],
  asia: [35, 180, -12, 78],
  africa: [-20, 55, -38, 38],
};
const aliases: Record<string, string> = {
  "United States": "United States of America",
  "USA": "United States of America",
  "Czech Republic": "Czechia",
  "Tanzania": "United Republic of Tanzania",
  "Ivory Coast": "Ivory Coast",
};
const mapWidth = 760;
const mapHeight = 440;
function borderPath(border: Border, bounds: [number, number, number, number]) {
  const [west, east, south, north] = bounds;
  return border.polygons.map((polygon) => polygon.map((ring) =>
    ring.map(([lon, lat], index) => {
      const x = (lon - west) / (east - west) * mapWidth;
      const y = (north - lat) / (north - south) * mapHeight;
      return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ") + " Z"
  ).join(" ")).join(" ");
}
const colors = ["#6657e8", "#26a4db", "#18ae91", "#f3a426", "#ed797a", "#9d71df", "#4f87be"];
const money = (currency: string, value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);
export function CustomerGeography({ locations, currency }: Props) {
  const [view, setView] = useState<MapView>("europe");
  const [borders, setBorders] = useState<Border[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/country-borders.json", { signal: controller.signal }).then((response) => response.json()).then((data: Border[]) => setBorders(data)).catch(() => {});
    return () => controller.abort();
  }, []);
  const shapes = useMemo(() => borders.map((border) => ({ name: border.name, path: borderPath(border, mapBounds[view]) })), [borders, view]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<"sales" | "customers" | "orders">("sales");
  const ranked = [...locations].filter((row) => row.sales > 0).sort((a, b) => b[sort] - a[sort]);
  const total = ranked.reduce((sum, row) => sum + row.sales, 0);
  const max = Math.max(1, ...ranked.map((row) => row.sales));
  const salesByCountry = new Map(ranked.map((row) => [aliases[row.country] ?? row.country, row]));
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
        <div className="geography-card-head"><div><span className="eyebrow">SALES GEOGRAPHY</span><h3>Explore customer locations</h3><p>Hover over a country to see its Shopify sales, customers and orders.</p></div>
          <label>Map view <select value={view} onChange={(event) => setView(event.target.value as MapView)}>
            <option value="europe">Europe</option><option value="world">World</option><option value="americas">Americas</option><option value="asia">Asia Pacific</option><option value="africa">Africa</option>
          </select></label></div>
        <div className="geography-globe-wrap geography-map-wrap"><svg viewBox={"0 0 " + mapWidth + " " + mapHeight} className="geography-map" role="img" aria-label={"Map of countries and Shopify sales in " + view}>
          <rect width={mapWidth} height={mapHeight} fill="#eaf3fb"/>
          {shapes.map((shape) => {
            const row = salesByCountry.get(shape.name);
            const intensity = row ? Math.min(1, Math.sqrt(row.sales / max)) : 0;
            const fill = row ? selected === row.country ? "#12a98c" : intensity > .72 ? "#6657e8" : intensity > .38 ? "#9687f2" : "#c4bcfa" : "#dce5e8";
            return <path key={shape.name} d={shape.path} fill={fill} fillRule="evenodd" stroke="#fff" strokeWidth="1.2" vectorEffect="non-scaling-stroke"
              className={row ? "geography-country has-sales" : "geography-country"} tabIndex={row ? 0 : -1}
              role={row ? "button" : undefined} aria-label={row ? row.country + ": " + money(currency, row.sales) + " sales" : shape.name}
              onMouseEnter={() => row && setSelected(row.country)} onFocus={() => row && setSelected(row.country)} onClick={() => row && setSelected(row.country)}>
              <title>{row ? row.country + ": " + money(currency, row.sales) + ", " + count(row.customers) + " customers, " + count(row.orders) + " orders" : shape.name + ": no Shopify sales in this period"}</title>
            </path>;
          })}
        </svg>{!borders.length && <div className="geography-map-loading">Loading country map…</div>}</div>
        {active && <div className="geography-selected"><strong>{active.country}</strong><span>{money(currency, active.sales)} sales</span><small>{count(active.customers)} customers · {count(active.orders)} orders</small></div>}
        <p className="report-note">Shading reflects sales among mapped countries. Very small countries may be too small to see at this scale; every country is listed below. Map boundaries: <a href="https://github.com/nvkelso/natural-earth-vector" target="_blank" rel="noreferrer">Natural Earth</a>.</p>
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
