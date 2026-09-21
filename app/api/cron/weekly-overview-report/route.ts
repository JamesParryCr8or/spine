import { createHmac, timingSafeEqual } from "node:crypto";

import { createReportingClient, refreshReportingData } from "@/lib/analytics/reporting-refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

type DailyRow = {
  sales_date: string;
  net_sales: string;
  gross_profit: string;
  orders: number;
};

type SpendRow = {
  date: string;
  spend: string;
  currency: string;
};

const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: number, currency: string) => new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency,
  maximumFractionDigits: 0,
}).format(value);

const friendlyDate = (date: string, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(`${date}T12:00:00Z`));

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const received = request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "") ?? "";
  if (received.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(secret));
}

function reportHtml(input: {
  storeName: string;
  currency: string;
  timezone: string;
  start: string;
  end: string;
  metrics: { netSales: number; grossProfit: number; marketingSpend: number; netProfit: number; orders: number; averageOrderValue: number };
  chart: Array<{ date: string; netSales: number; grossProfit: number; marketingSpend: number; netProfit: number }>;
}) {
  const { storeName, currency, timezone, start, end, metrics, chart } = input;
  const max = Math.max(1, ...chart.flatMap((row) => [row.netSales, row.grossProfit, row.marketingSpend, Math.abs(row.netProfit)]));
  const cards = [
    ["Net sales", money(metrics.netSales, currency)],
    ["Gross profit", money(metrics.grossProfit, currency)],
    ["Marketing", money(metrics.marketingSpend, currency)],
    ["Net profit", money(metrics.netProfit, currency)],
    ["Orders", new Intl.NumberFormat("en-GB").format(metrics.orders)],
    ["Average order value", money(metrics.averageOrderValue, currency)],
  ];
  const chartRows = chart.map((row) => {
    const revenue = Math.max(3, Math.round((row.netSales / max) * 100));
    const profit = Math.max(3, Math.round((row.grossProfit / max) * 100));
    const marketing = Math.max(3, Math.round((row.marketingSpend / max) * 100));
    return `<tr>
      <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;color:#53627a;font-size:12px;white-space:nowrap">${friendlyDate(row.date, timezone)}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;width:38%"><div style="height:10px;border-radius:6px;background:#f1efff"><div style="width:${revenue}%;height:10px;border-radius:6px;background:#7057eb"></div></div></td>
      <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;color:#17213a;font-size:12px;text-align:right;white-space:nowrap">${money(row.netSales, currency)}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;width:20%"><div style="height:8px;border-radius:6px;background:#e9f8f2"><div style="width:${profit}%;height:8px;border-radius:6px;background:#20b982"></div></div></td>
      <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;width:20%"><div style="height:8px;border-radius:6px;background:#fff0eb"><div style="width:${marketing}%;height:8px;border-radius:6px;background:#f17b5f"></div></div></td>
    </tr>`;
  }).join("");

  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#17213a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px"><tr><td align="center">
      <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:18px;overflow:hidden">
        <tr><td style="padding:30px 34px;background:#11182b;color:white"><div style="font-size:13px;letter-spacing:2px;color:#bcb3ff;font-weight:700">SPINE · WEEKLY REPORT</div><h1 style="margin:10px 0 4px;font-size:28px">${escapeHtml(storeName)}</h1><div style="color:#c5cad8;font-size:14px">${friendlyDate(start, timezone)} – ${friendlyDate(end, timezone)}</div></td></tr>
        <tr><td style="padding:26px 26px 4px"><table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>${cards.slice(0, 3).map(([label, value]) => `<td width="33%" style="border:1px solid #e8eaf0;border-radius:12px;padding:16px"><div style="font-size:11px;letter-spacing:1px;color:#75809a;font-weight:700;text-transform:uppercase">${label}</div><div style="font-size:21px;font-weight:700;margin-top:7px">${value}</div></td>`).join("")}</tr><tr>${cards.slice(3).map(([label, value]) => `<td width="33%" style="border:1px solid #e8eaf0;border-radius:12px;padding:16px"><div style="font-size:11px;letter-spacing:1px;color:#75809a;font-weight:700;text-transform:uppercase">${label}</div><div style="font-size:21px;font-weight:700;margin-top:7px">${value}</div></td>`).join("")}</tr></table></td></tr>
        <tr><td style="padding:24px 34px 34px"><h2 style="font-size:18px;margin:0 0 8px">Revenue, costs and profit</h2><div style="font-size:12px;color:#75809a;margin-bottom:16px"><span style="color:#7057eb">● Revenue</span>&nbsp;&nbsp;<span style="color:#20b982">● Gross profit</span>&nbsp;&nbsp;<span style="color:#f17b5f">● Marketing</span></div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${chartRows}</table></td></tr>
        <tr><td style="padding:16px 34px;background:#f6f7fb;color:#75809a;font-size:12px">Generated by Spine from your imported Shopify, Meta and Google Ads data.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const webhookUrl = process.env.GHL_WEEKLY_REPORT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return Response.json({ error: "GHL_WEEKLY_REPORT_WEBHOOK_URL is not configured" }, { status: 503 });

  let webhook: URL;
  try {
    webhook = new URL(webhookUrl);
  } catch {
    return Response.json({ error: "GHL_WEEKLY_REPORT_WEBHOOK_URL must be a valid URL" }, { status: 500 });
  }
  if (webhook.protocol !== "https:") return Response.json({ error: "GHL webhook must use HTTPS" }, { status: 500 });

  const reporting = createReportingClient();
  const { data: stores, error: storesError } = await reporting
    .from("stores")
    .select("id,organization_id,name,currency,timezone,shopify_domain");
  if (storesError) return Response.json({ error: storesError.message }, { status: 500 });

  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const from = dayKey(start);
  const to = dayKey(end);
  const generatedAt = new Date().toISOString();
  const reports = [];

  for (const store of stores ?? []) {
    try {
      await refreshReportingData(reporting, store, from, to);
      const [salesResult, metaResult, googleResult] = await Promise.all([
        reporting.from("shopify_sales_daily").select("sales_date,net_sales,gross_profit,orders").eq("store_id", store.id).gte("sales_date", from).lte("sales_date", to).order("sales_date"),
        reporting.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).gte("date_start", from).lte("date_start", to),
        reporting.from("google_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", from).lte("insight_date", to),
      ]);
      const readError = salesResult.error ?? metaResult.error ?? googleResult.error;
      if (readError) throw readError;

      const sales = (salesResult.data ?? []) as DailyRow[];
      const spendByDay = new Map<string, number>();
      for (const row of metaResult.data ?? []) if (row.currency === store.currency) spendByDay.set(row.date_start, (spendByDay.get(row.date_start) ?? 0) + number(row.spend));
      for (const row of googleResult.data ?? []) if (row.currency === store.currency) spendByDay.set(row.insight_date, (spendByDay.get(row.insight_date) ?? 0) + number(row.spend));

      const salesByDay = new Map(sales.map((row) => [row.sales_date, row]));
      const chart = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + index);
        const key = dayKey(date);
        const row = salesByDay.get(key);
        const netSales = number(row?.net_sales);
        const grossProfit = number(row?.gross_profit);
        const marketingSpend = spendByDay.get(key) ?? 0;
        return { date: key, netSales, grossProfit, marketingSpend, netProfit: grossProfit - marketingSpend };
      });
      const metrics = chart.reduce((total, row) => ({
        netSales: total.netSales + row.netSales,
        grossProfit: total.grossProfit + row.grossProfit,
        marketingSpend: total.marketingSpend + row.marketingSpend,
        netProfit: total.netProfit + row.netProfit,
        orders: total.orders + (salesByDay.get(row.date)?.orders ?? 0),
      }), { netSales: 0, grossProfit: 0, marketingSpend: 0, netProfit: 0, orders: 0 });
      const payload = {
        event: "spine.weekly_overview_report",
        generatedAt,
        report: {
          store: { id: store.id, name: store.name, currency: store.currency, timezone: store.timezone || "UTC" },
          period: { from, to },
          metrics: { ...metrics, averageOrderValue: metrics.orders ? metrics.netSales / metrics.orders : 0 },
          chart,
          html: reportHtml({ storeName: store.name, currency: store.currency, timezone: store.timezone || "UTC", start: from, end: to, metrics: { ...metrics, averageOrderValue: metrics.orders ? metrics.netSales / metrics.orders : 0 }, chart }),
        },
      };
      const body = JSON.stringify(payload);
      const signingSecret = process.env.GHL_WEEKLY_REPORT_WEBHOOK_SECRET?.trim();
      const response = await fetch(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Spine-Weekly-Report/1.0",
          ...(signingSecret ? { "X-Spine-Signature": createHmac("sha256", signingSecret).update(body).digest("hex") } : {}),
        },
        body,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`GHL webhook responded with ${response.status}`);
      reports.push({ storeId: store.id, storeName: store.name, delivered: true });
    } catch (error) {
      console.error("Weekly report delivery failed", { storeId: store.id, message: error instanceof Error ? error.message : "Unknown error" });
      reports.push({ storeId: store.id, storeName: store.name, delivered: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  const delivered = reports.filter((report) => report.delivered).length;
  return Response.json({ generatedAt, period: { from, to }, delivered, failed: reports.length - delivered, reports }, { status: delivered ? 200 : 502 });
}
