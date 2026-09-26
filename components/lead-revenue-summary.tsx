"use client";
import { useEffect, useState } from "react";
import styles from "./revenue.module.css";
export function LeadRevenueSummary({ from, to }: { from:string; to:string }) {
  const [data,setData]=useState<{currency:string;summary:{netRevenue:number;costs:number;afterAdSpend:number|null}}|null>(null);
  useEffect(()=>{const controller=new AbortController();const params=new URLSearchParams();if(from)params.set("from",from);if(to)params.set("to",to);void fetch(`/api/revenue?${params}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(setData).catch(()=>{});return()=>controller.abort();},[from,to]);
  if(!data)return null;
  const money=(value:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:data.currency,maximumFractionDigits:0}).format(value);
  return <section className={styles.root}><div className={styles.grid}>{[["Net collected revenue",data.summary.netRevenue],["External costs",data.summary.costs],["After costs & imported ads",data.summary.afterAdSpend]].map(([label,value])=><article className={styles.card} key={String(label)}><span className="eyebrow">{label}</span><div className={styles.value}>{value===null?"—":money(Number(value))}</div></article>)}</div><p>Stripe and external receipts for this period. Separate from GHL pipeline value. Processing fees and unimported costs are excluded. Manage imports in Revenue & Costs.</p></section>;
}
