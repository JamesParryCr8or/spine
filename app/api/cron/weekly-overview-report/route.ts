import { NextResponse } from "next/server";

import { createReportingClient, refreshReportingData } from "@/lib/analytics/reporting-refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

type Store = {
  id: string;
  organization_id: string;
  name: string;
  currency: string;
  timezone: string | null;
  shopify_domain: string | null;
};

type SalesDay = {
  sales_date: string;
  net_sales: string;
  gross_profit: string;
  orders: number;
};

type SpendDay = {
  date: string;
  spend: string;
  currency: string;
};

const asNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function makeHtml(input: {
  storeName: string;
  currency: string;
  from: string;
  to: string;
  metrics: {
    netSales: number;
    grossProfit: number;
    marketingSpend: number;
    netProfit: number;
    orders: number;
    averageOrderValue: number;
  };
  chart: Array<{
    date: string;
    netSales: number;
    grossProfit: number;
    marketingSpend: number;
    netProfit: number;
  }>;
}) {
  const metricCells = [
    ["Net sales", formatMoney(input.metrics.netSales, input.currency)],
    ["Gross profit", formatMoney(input.metrics.grossProfit, input.currency)],
    ["Marketing", formatMoney(input.metrics.marketingSpend, input.currency)],
    ["Net profit", formatMoney(input.metrics.netProfit, input.currency)],
    ["Orders", new Intl.NumberFormat("en-GB").format(input.metrics.orders)],
    ["Average order value", formatMoney(input.metrics.averageOrderValue, input.currency)],
  ];
  const dailyRows = input.chart
    .map(
      (row) =>
        "<tr>" +
        "<td style=\"padding:10px;border-bottom:1px solid #e8eaf0\">" + row.date + "</td>" +
        "<td style=\"padding:10px;border-bottom:1px solid #e8eaf0;text-align:right\">" + formatMoney(row.netSales, input.currency) + "</td>" +
        "<td style=\"padding:10px;border-bottom:1px solid #e8eaf0;text-align:right\">" + formatMoney(row.grossProfit, input.currency) + "</td>" +
        "<td style=\"padding:10px;border-bottom:1px solid #e8eaf0;text-align:right\">" + formatMoney(row.marketingSpend, input.currency) + "</td>" +
        "<td style=\"padding:10px;border-bottom:1px solid #e8eaf0;text-align:right\">" + formatMoney(row.netProfit, input.currency) + "</td>" +
        "</tr>",
    )
    .join("");

  return "<!doctype html><html><body style=\"margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#17213a\">" +
    "<div style=\"max-width:680px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden\">" +
    "<div style=\"padding:28px 32px;background:#11182b;color:#fff\"><div style=\"font-size:12px;letter-spacing:2px;color:#bcb3ff\">SPINE · WEEKLY REPORT</div><h1 style=\"margin:10px 0 4px\">" + escapeHtml(input.storeName) + "</h1><div style=\"color:#c5cad8\">" + input.from + " to " + input.to + "</div></div>" +
    "<div style=\"padding:24px\"><table width=\"100%\" cellspacing=\"8\"><tr>" +
    metricCells.slice(0, 3).map(([label, value]) => "<td style=\"width:33%;border:1px solid #e8eaf0;border-radius:10px;padding:14px\"><div style=\"font-size:11px;color:#75809a;text-transform:uppercase\">" + label + "</div><strong style=\"font-size:20px\">" + value + "</strong></td>").join("") +
    "</tr><tr>" + metricCells.slice(3).map(([label, value]) => "<td style=\"width:33%;border:1px solid #e8eaf0;border-radius:10px;padding:14px\"><div style=\"font-size:11px;color:#75809a;text-transform:uppercase\">" + label + "</div><strong style=\"font-size:20px\">" + value + "</strong></td>").join("") +
    "</tr></table><h2 style=\"font-size:18px;margin:26px 0 10px\">Daily revenue, cost and profit</h2><table width=\"100%\" cellspacing=\"0\" style=\"font-size:13px\"><thead><tr style=\"color:#75809a;text-align:left\"><th style=\"padding:10px\">Day</th><th style=\"padding:10px;text-align:right\">Revenue</th><th style=\"padding:10px;text-align:right\">Gross profit</th><th style=\"padding:10px;text-align:right\">Marketing</th><th style=\"padding:10px;text-align:right\">Net profit</th></tr></thead><tbody>" +
    dailyRows +
    "</tbody></table></div></div></body></html>";
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== "Bearer " + cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.GHL_WEEKLY_REPORT_WEBHOOK_URL?.trim();
  if (!webhookUrl || !webhookUrl.startsWith("https://")) {
    return NextResponse.json({ error: "Set GHL_WEEKLY_REPORT_WEBHOOK_URL to your HTTPS GoHighLevel webhook" }, { status: 503 });
  }

  const reporting = createReportingClient();
  const { data: storeData, error: storesError } = await reporting
    .from("stores")
    .select("id,organization_id,name,currency,timezone,shopify_domain");
  if (storesError) return NextResponse.json({ error: storesError.message }, { status: 500 });

  const stores = (storeData ?? []) as Store[];
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const start = new Date(yesterday);
  start.setUTCDate(start.getUTCDate() - 6);
  const from = isoDate(start);
  const to = isoDate(yesterday);
  const delivered: Array<{ storeId: string; storeName: string }> = [];
  const failed: Array<{ storeId: string; storeName: string; error: string }> = [];

  for (const store of stores) {
    try {
      await refreshReportingData(reporting, store, from, to);
      const [salesResult, metaResult, googleResult] = await Promise.all([
        reporting.from("shopify_sales_daily").select("sales_date,net_sales,gross_profit,orders").eq("store_id", store.id).gte("sales_date", from).lte("sales_date", to).order("sales_date", { ascending: true }),
        reporting.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).gte("date_start", from).lte("date_start", to),
        reporting.from("google_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", from).lte("insight_date", to),
      ]);
      const readError = salesResult.error ?? metaResult.error ?? googleResult.error;
      if (readError) throw readError;

      const salesByDay = new Map<string, SalesDay>();
      for (const row of (salesResult.data ?? []) as SalesDay[]) salesByDay.set(row.sales_date, row);
      const marketingByDay = new Map<string, number>();
      for (const row of metaResult.data ?? []) {
        const spend = row as unknown as SpendDay;
        if (spend.currency === store.currency) marketingByDay.set(spend.date, (marketingByDay.get(spend.date) ?? 0) + asNumber(spend.spend));
      }
      for (const row of googleResult.data ?? []) {
        const spend = row as unknown as SpendDay;
        if (spend.currency === store.currency) marketingByDay.set(spend.date, (marketingByDay.get(spend.date) ?? 0) + asNumber(spend.spend));
      }

      const chart = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + index);
        const key = isoDate(date);
        const sales = salesByDay.get(key);
        const netSales = asNumber(sales?.net_sales);
        const grossProfit = asNumber(sales?.gross_profit);
        const marketingSpend = marketingByDay.get(key) ?? 0;
        return { date: key, netSales, grossProfit, marketingSpend, netProfit: grossProfit - marketingSpend, orders: sales?.orders ?? 0 };
      });
      const totals = chart.reduce((total, row) => ({
        netSales: total.netSales + row.netSales,
        grossProfit: total.grossProfit + row.grossProfit,
        marketingSpend: total.marketingSpend + row.marketingSpend,
        netProfit: total.netProfit + row.netProfit,
        orders: total.orders + row.orders,
      }), { netSales: 0, grossProfit: 0, marketingSpend: 0, netProfit: 0, orders: 0 });
      const metrics = { ...totals, averageOrderValue: totals.orders ? totals.netSales / totals.orders : 0 };
      const payload = {
        event: "spine.weekly_overview_report",
        generatedAt: new Date().toISOString(),
        report: {
          store: { id: store.id, name: store.name, currency: store.currency, timezone: store.timezone ?? "UTC" },
          period: { from, to },
          metrics,
          chart: chart.map(({ orders: _orders, ...row }) => row),
          html: makeHtml({ storeName: store.name, currency: store.currency, from, to, metrics, chart: chart.map(({ orders: _orders, ...row }) => row) }),
        },
      };
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Spine-Weekly-Report/1.0" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("GHL webhook returned " + response.status);
      delivered.push({ storeId: store.id, storeName: store.name });
    } catch (error) {
      failed.push({ storeId: store.id, storeName: store.name, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return NextResponse.json({ period: { from, to }, delivered, failed }, { status: failed.length ? 207 : 200 });
}
