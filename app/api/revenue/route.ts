import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace/server";
import { revenueSummary, validDate, type RevenueEntry } from "@/lib/revenue/schema";

export async function GET(request: Request) {
  const w = await requireWorkspace(); if (!w.ok) return w.response;
  if (!w.store) return NextResponse.json({ error: "Choose a store" }, { status: 404 });
  const url = new URL(request.url), from = url.searchParams.get("from") || "2000-01-01", to = url.searchParams.get("to") || "2100-12-31";
  if (!validDate(from) || !validDate(to) || from > to) return NextResponse.json({ error: "Choose a valid date range" }, { status: 400 });
  const entries: Array<RevenueEntry & { source: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await w.supabase.from("revenue_entries").select("entry_key,external_id,entry_date,kind,label,amount_minor,currency,opportunity_id,source").eq("store_id", w.store.id).gte("entry_date", from).lte("entry_date", to).order("entry_key").range(offset, offset+999);
    if (result.error) return NextResponse.json({ error: "Revenue data is unavailable" }, { status: 503 });
    entries.push(...result.data);
    if (result.data.length < 1000) break;
    if (offset >= 99000) return NextResponse.json({ error: "Choose a smaller period to view revenue" }, { status: 400 });
  }
  const batches = await w.supabase.from("revenue_import_batches").select("id,source,name,row_count,created_at,rolled_back_at").eq("store_id", w.store.id).order("sequence", { ascending: false }).limit(30);
  const currency = w.store.reporting_currency || w.store.currency;
  const spendResults = await Promise.all(["meta_ad_insights_daily", "google_ads_insights_daily"].map(async table => {
    let total = 0, rows = 0, foreign = 0;
    const dateColumn = table === "meta_ad_insights_daily" ? "date_start" : "insight_date";
    for (let offset = 0; ; offset += 1000) {
      const result = await w.supabase.from(table).select("spend,currency,id").eq("store_id", w.store!.id).gte(dateColumn, from).lte(dateColumn, to).order("id").range(offset,offset+999);
      if (result.error) return null;
      for (const row of result.data) { if (row.currency === currency) { total += Number(row.spend); rows++; } else foreign++; }
      if (result.data.length < 1000) return { total, rows, foreign };
      if (offset >= 99000) return null;
    }
  }));
  try {
    const summary = revenueSummary(entries, currency);
    const spendAvailable = spendResults.every(Boolean) && spendResults.some(s => s!.rows > 0);
    const adSpend = spendAvailable ? spendResults.reduce((sum,s) => sum + s!.total,0) : null;
    return NextResponse.json({ currency, summary: { ...summary, adSpend, afterAdSpend: adSpend === null ? null : summary.netAfterCosts-adSpend, foreignSpendRows: spendResults.reduce((sum,s) => sum+(s?.foreign||0),0) }, entries: entries.sort((a,b) => b.entry_date.localeCompare(a.entry_date)).slice(0,100), count: entries.length, batches: batches.data || [], canEdit: ["owner", "admin"].includes(w.membership.role) });
  } catch { return NextResponse.json({ error: "Revenue totals exceed the supported range. Choose a smaller period." }, { status: 400 }); }
}
