import { NextResponse } from "next/server";

import { createReportingClient } from "@/lib/analytics/reporting-refresh";

export const maxDuration = 60;

type Daily = {
  sales_date: string;
  net_sales: string;
  sales_reversals: string;
  orders: number;
  net_items_sold: number;
  cost_of_goods_sold: string;
  net_sales_without_cost_recorded: string;
  total_payment_fees: string;
};
type Spend = { spend: string; currency: string };
type Defaults = {
  fulfilment_amount: string;
  fulfilment_basis: "orders" | "units";
  postage_amount: string;
  postage_basis: "orders" | "units";
  default_cogs_percent: string;
  currency: string;
};

const number = (value: string | number | null | undefined) => Number(value ?? 0) || 0;
const money = (value: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const day = (date: Date) => date.toISOString().slice(0, 10);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function priorWeek() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: day(start), end: day(end) };
}

function chart(rows: Array<{ label: string; revenue: number; costs: number; profit: number }>, currency: string) {
  const width = 640, height = 250, left = 40, right = 18, top = 16, bottom = 218, zero = 128;
  const plotWidth = width - left - right;
  const step = plotWidth / Math.max(rows.length, 1);
  const positive = Math.max(...rows.flatMap((row) => [row.revenue, row.profit, 1]));
  const negative = Math.max(...rows.map((row) => row.costs), ...rows.map((row) => Math.max(-row.profit, 0)), 1);
  const y = (value: number) => value >= 0 ? zero - value / positive * (zero - top) : zero + Math.abs(value) / negative * (bottom - zero);
  const profitLine = rows.map((row, index) => `${left + step * index + step / 2},${y(row.profit)}`).join(" ");
  const bars = rows.map((row, index) => {
    const x = left + step * index + step / 2 - Math.min(26, step * .42) / 2;
    const barWidth = Math.min(26, step * .42);
    const revenueTop = y(row.revenue);
    const costHeight = row.costs / negative * (bottom - zero);
    const label = escapeHtml(row.label);
    return `<g><rect x="${x}" y="${revenueTop}" width="${barWidth}" height="${Math.max(zero - revenueTop, 1)}" rx="4" fill="#7057f6"/><rect x="${x}" y="${zero}" width="${barWidth}" height="${Math.max(costHeight, 0)}" fill="#f59e0b"/><text x="${x + barWidth / 2}" y="241" text-anchor="middle" fill="#718096" font-size="10">${label}</text></g>`;
  }).join("");
  return `<svg width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue, costs and profit"><line x1="${left}" x2="${width - right}" y1="${zero}" y2="${zero}" stroke="#cbd5e1"/><line x1="${left}" x2="${width - right}" y1="72" y2="72" stroke="#edf2f7"/><line x1="${left}" x2="${width - right}" y1="184" y2="184" stroke="#edf2f7"/>${bars}<polyline points="${profitLine}" fill="none" stroke="#10b981" stroke-width="3"/>${rows.map((row, index) => `<circle cx="${left + step * index + step / 2}" cy="${y(row.profit)}" r="3.5" fill="#10b981"/>`).join("")}</svg>`;
}

function reportHtml(input: {
  storeName: string; currency: string; start: string; end: string; netSales: number; orders: number; grossProfit: number;
  marketing: number; postage: number; fulfilment: number; fees: number; netProfit: number; trend: Array<{ label: string; revenue: number; costs: number; profit: number }>;
}) {
  const cards = [
    ["Net sales", money(input.netSales, input.currency)],
    ["Orders", input.orders.toLocaleString("en-GB")],
    ["Gross profit", money(input.grossProfit, input.currency)],
    ["Marketing", money(input.marketing, input.currency)],
    ["Postage", money(input.postage, input.currency)],
    ["Warehouse fulfilment", money(input.fulfilment, input.currency)],
    ["Transaction fees", money(input.fees, input.currency)],
    ["Net profit", money(input.netProfit, input.currency)],
  ];
  return `<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:Arial,sans-serif;color:#101828"><div style="max-width:720px;margin:0 auto;padding:28px 16px"><div style="background:#121a33;padding:26px 30px;border-radius:18px 18px 0 0;color:#fff"><div style="font-size:13px;letter-spacing:1.6px;font-weight:700;color:#a99bff">SPINE · WEEKLY REPORT</div><h1 style="margin:9px 0 4px;font-size:30px">${escapeHtml(input.storeName)}</h1><p style="margin:0;color:#c6cddd">${input.start} – ${input.end}</p></div><div style="background:#fff;padding:24px 30px;border-radius:0 0 18px 18px"><h2 style="font-size:18px;margin:0 0 14px">This week at a glance</h2><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:10px"><tbody><tr>${cards.slice(0,4).map(([label,value]) => `<td width="25%" style="border:1px solid #e7eaf3;border-radius:10px;padding:14px 12px;vertical-align:top"><div style="font-size:10px;color:#667085;font-weight:700;letter-spacing:.7px;text-transform:uppercase">${label}</div><div style="font-size:18px;font-weight:700;margin-top:7px">${value}</div></td>`).join("")}</tr><tr>${cards.slice(4).map(([label,value]) => `<td width="25%" style="border:1px solid #e7eaf3;border-radius:10px;padding:14px 12px;vertical-align:top"><div style="font-size:10px;color:#667085;font-weight:700;letter-spacing:.7px;text-transform:uppercase">${label}</div><div style="font-size:18px;font-weight:700;margin-top:7px">${value}</div></td>`).join("")}</tr></tbody></table><div style="margin-top:25px;border:1px solid #e7eaf3;border-radius:12px;padding:18px"><div style="font-size:18px;font-weight:700">Revenue, costs and profit</div><div style="font-size:12px;color:#667085;margin:6px 0 14px"><span style="color:#7057f6">● Revenue</span> &nbsp; <span style="color:#f59e0b">● Costs</span> &nbsp; <span style="color:#10b981">● Net profit</span></div>${chart(input.trend, input.currency)}</div><p style="font-size:12px;line-height:18px;color:#667085;margin:22px 0 0">Postage and fulfilment use your saved store defaults. Open Spine to explore the full report.</p></div></div></body></html>`;
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.REPORT_FROM_EMAIL?.trim();
  if (!apiKey || !from) return NextResponse.json({ error: "Set RESEND_API_KEY and REPORT_FROM_EMAIL before enabling weekly reports" }, { status: 503 });

  const supabase = createReportingClient();
  const { start, end } = priorWeek();
  const { data: stores, error: storesError } = await supabase.from("stores").select("id,organization_id,name,currency").not("shopify_domain", "is", null);
  if (storesError) return NextResponse.json({ error: storesError.message }, { status: 500 });

  const results = [];
  for (const store of stores ?? []) {
    const [dailyResult, metaResult, googleResult, defaultsResult, ownerResult] = await Promise.all([
      supabase.from("shopify_sales_daily").select("sales_date,net_sales,sales_reversals,orders,net_items_sold,cost_of_goods_sold,net_sales_without_cost_recorded,total_payment_fees").eq("store_id", store.id).gte("sales_date", start).lte("sales_date", end).order("sales_date"),
      supabase.from("meta_ad_insights_daily").select("spend,currency").eq("store_id", store.id).gte("date_start", start).lte("date_start", end),
      supabase.from("google_ads_insights_daily").select("spend,currency").eq("store_id", store.id).gte("insight_date", start).lte("insight_date", end),
      supabase.from("store_cost_defaults").select("fulfilment_amount,fulfilment_basis,postage_amount,postage_basis,default_cogs_percent,currency").eq("store_id", store.id).maybeSingle(),
      supabase.from("organization_members").select("user_id").eq("organization_id", store.organization_id).eq("role", "owner"),
    ]);
    const error = dailyResult.error ?? metaResult.error ?? googleResult.error ?? defaultsResult.error ?? ownerResult.error;
    if (error || !(dailyResult.data?.length)) { results.push({ store: store.name, status: "skipped", reason: error?.message ?? "No sales data" }); continue; }
    const recipients = (await Promise.all((ownerResult.data ?? []).map(async (owner) => (await supabase.auth.admin.getUserById(owner.user_id)).data.user?.email ?? null))).filter((email): email is string => Boolean(email));
    if (!recipients.length) { results.push({ store: store.name, status: "skipped", reason: "No owner email" }); continue; }

    const daily = dailyResult.data as Daily[];
    const defaults = defaultsResult.data as Defaults | null;
    const netSales = daily.reduce((total, row) => total + number(row.net_sales), 0);
    const refunds = daily.reduce((total, row) => total + Math.abs(number(row.sales_reversals)), 0);
    const orders = daily.reduce((total, row) => total + number(row.orders), 0);
    const units = daily.reduce((total, row) => total + number(row.net_items_sold), 0);
    const marketing = [...(metaResult.data as Spend[] ?? []), ...(googleResult.data as Spend[] ?? [])].reduce((total, row) => row.currency === store.currency ? total + number(row.spend) : total, 0);
    const defaultRate = defaults?.currency === store.currency ? number(defaults.default_cogs_percent) / 100 : 0;
    const cogs = daily.reduce((total, row) => total + number(row.cost_of_goods_sold) + Math.max(number(row.net_sales_without_cost_recorded), 0) * defaultRate, 0);
    const fees = daily.reduce((total, row) => total + number(row.total_payment_fees), 0);
    const postage = defaults?.currency === store.currency ? number(defaults.postage_amount) * (defaults.postage_basis === "units" ? units : orders) : 0;
    const fulfilment = defaults?.currency === store.currency ? number(defaults.fulfilment_amount) * (defaults.fulfilment_basis === "units" ? units : orders) : 0;
    const grossProfit = netSales - refunds - cogs;
    const netProfit = grossProfit - marketing - fees - postage - fulfilment;
    const trend = daily.map((row) => {
      const revenue = number(row.net_sales) - Math.abs(number(row.sales_reversals));
      const rowCogs = number(row.cost_of_goods_sold) + Math.max(number(row.net_sales_without_cost_recorded), 0) * defaultRate;
      const allocatedMarketing = orders ? marketing * number(row.orders) / orders : 0;
      const allocatedPostage = orders ? postage * number(row.orders) / orders : 0;
      const allocatedFulfilment = orders ? fulfilment * number(row.orders) / orders : 0;
      const costs = rowCogs + number(row.total_payment_fees) + allocatedMarketing + allocatedPostage + allocatedFulfilment;
      return { label: row.sales_date.slice(5), revenue, costs, profit: revenue - costs };
    });
    const payload = { from, to: recipients, subject: `Spine weekly report · ${store.name} · ${start} – ${end}`, html: reportHtml({ storeName: store.name, currency: store.currency, start, end, netSales: netSales - refunds, orders, grossProfit, marketing, postage, fulfilment, fees, netProfit, trend }) };
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `spine-weekly-${store.id}- ${end}`.replace(" ", "") }, body: JSON.stringify(payload) });
    if (!response.ok) { results.push({ store: store.name, status: "failed", reason: "Email provider rejected the report" }); continue; }
    results.push({ store: store.name, status: "sent", recipients: recipients.length });
  }
  return NextResponse.json({ start, end, results });
}
