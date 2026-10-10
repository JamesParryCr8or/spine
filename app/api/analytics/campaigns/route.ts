import { NextResponse } from "next/server";

import { computeCampaignPerformance, type AdCampaignSpend, type AttributionModel, type CampaignDay, type Platform, type PlatformSpendDay } from "@/lib/analytics/campaign-performance";
import { createCurrencyConversionCoverage } from "@/lib/analytics/exchange-rate";
import { convertDatedAmount, resolveDatedExchangeRate, type DatedExchangeRate } from "@/lib/analytics/exchange-rate";
import { monetary } from "@/lib/analytics/effective-cost";
import { selectAllPages } from "@/lib/supabase/select-all";
import { requireWorkspace } from "@/lib/workspace/server";

const models: AttributionModel[] = ["last_non_direct", "last_click", "first_click"];
const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

type SpendRow = { spend: string | number; currency: string };
type MetaCampaignRow = SpendRow & { campaign_id: string; campaign_name: string; date_start: string };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const requestedModel = params.get("model") as AttributionModel | null;
  const model = requestedModel && models.includes(requestedModel) ? requestedModel : "last_non_direct";
  if (!isDate(from) || !isDate(to) || from > to) return NextResponse.json({ error: "Use a valid start and end date" }, { status: 400 });

  const workspace = await requireWorkspace();
  if (!workspace.ok) return workspace.response;
  const { supabase, store } = workspace;
  if (!store) return NextResponse.json({ error: "No store is configured" }, { status: 404 });

  const [rateResult, dayResult, salesResult, stateResult, mappingResult, customResult, metaAccount, googleAccount, bingAccount, metaCampaigns] = await Promise.all([
    supabase.from("exchange_rates").select("base_currency,quote_currency,rate,effective_date").eq("store_id", store.id).eq("quote_currency", store.currency).order("effective_date", { ascending: true }),
    selectAllPages<CampaignDay>((range) => supabase.from("shopify_campaign_daily")
      .select("sales_date,utm_source,utm_medium,utm_campaign,customer_type,last_click_orders,last_click_sales,last_non_direct_orders,last_non_direct_sales,first_click_orders,first_click_sales")
      .eq("store_id", store.id).gte("sales_date", from).lte("sales_date", to)
      .order("sales_date", { ascending: true }).order("utm_source", { ascending: true }).order("utm_medium", { ascending: true }).order("utm_campaign", { ascending: true }).order("customer_type", { ascending: true })
      .range(range.from, range.to)),
    selectAllPages<{ sales_date: string; total_sales: string | number }>((range) => supabase.from("shopify_sales_daily").select("sales_date,total_sales").eq("store_id", store.id).gte("sales_date", from).lte("sales_date", to).order("sales_date", { ascending: true }).range(range.from, range.to)),
    supabase.from("shopify_campaign_sync_state").select("backfilled_from,synced_at").eq("store_id", store.id).maybeSingle(),
    supabase.from("campaign_mappings").select("external_campaign_id,utm_source,utm_medium,utm_campaign").eq("store_id", store.id).eq("platform", "meta"),
    supabase.from("custom_spend_daily").select("spend_date,source,medium,campaign,spend,currency").eq("store_id", store.id).gte("spend_date", from).lte("spend_date", to),
    selectAllPages<SpendRow & { date_start: string }>((range) => supabase.from("meta_ad_insights_daily").select("date_start,spend,currency").eq("store_id", store.id).gte("date_start", from).lte("date_start", to).order("date_start", { ascending: true }).order("account_id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<SpendRow & { insight_date: string }>((range) => supabase.from("google_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", from).lte("insight_date", to).order("insight_date", { ascending: true }).order("customer_id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<SpendRow & { insight_date: string }>((range) => supabase.from("bing_ads_insights_daily").select("insight_date,spend,currency").eq("store_id", store.id).gte("insight_date", from).lte("insight_date", to).order("insight_date", { ascending: true }).order("account_id", { ascending: true }).range(range.from, range.to)),
    selectAllPages<MetaCampaignRow>((range) => supabase.from("meta_campaign_insights_daily").select("campaign_id,campaign_name,date_start,spend,currency").eq("store_id", store.id).gte("date_start", from).lte("date_start", to).order("date_start", { ascending: true }).order("campaign_id", { ascending: true }).range(range.from, range.to)),
  ]);
  const failure = rateResult.error?.message ?? dayResult.error ?? salesResult.error ?? stateResult.error?.message ?? mappingResult.error?.message ?? customResult.error?.message ?? metaAccount.error ?? googleAccount.error ?? bingAccount.error ?? metaCampaigns.error;
  if (failure) return NextResponse.json({ error: failure }, { status: 500 });

  const rates = (rateResult.data ?? []) as DatedExchangeRate[];
  const coverage = createCurrencyConversionCoverage(store.currency);
  /** Spend in the store currency, or null when no exchange rate exists (counted in coverage, never guessed). */
  const toStore = (row: SpendRow, date: string) => {
    const rate = resolveDatedExchangeRate(rates, row.currency, store.currency, date);
    if (!coverage.include(row.currency, rate)) return null;
    return convertDatedAmount(monetary(row.spend), rate ?? 1, store.currency);
  };

  const platformSpend: PlatformSpendDay[] = [];
  const addPlatform = (platform: Platform, rows: Array<SpendRow & { date: string }>) => {
    for (const row of rows) { const spend = toStore(row, row.date); if (spend !== null) platformSpend.push({ platform, date: row.date, spend }); }
  };
  addPlatform("meta", metaAccount.rows.map((row) => ({ ...row, date: row.date_start })));
  addPlatform("google", googleAccount.rows.map((row) => ({ ...row, date: row.insight_date })));
  addPlatform("microsoft", bingAccount.rows.map((row) => ({ ...row, date: row.insight_date })));

  const campaignTotals = new Map<string, AdCampaignSpend>();
  for (const row of metaCampaigns.rows) {
    const spend = toStore(row, row.date_start);
    if (spend === null) continue;
    const existing = campaignTotals.get(row.campaign_id);
    campaignTotals.set(row.campaign_id, { platform: "meta", campaignId: row.campaign_id, campaignName: row.campaign_name, spend: (existing?.spend ?? 0) + spend });
  }

  const customSpend = ((customResult.data ?? []) as Array<SpendRow & { spend_date: string; source: string; medium: string; campaign: string }>).flatMap((row) => {
    const spend = toStore(row, row.spend_date);
    return spend === null ? [] : [{ source: row.source, medium: row.medium, campaign: row.campaign, spend }];
  });

  const performance = computeCampaignPerformance({
    days: dayResult.rows,
    model,
    platformSpend,
    adCampaigns: [...campaignTotals.values()],
    mappings: (mappingResult.data ?? []).map((mapping) => ({ campaignId: mapping.external_campaign_id, source: mapping.utm_source, medium: mapping.utm_medium, campaign: mapping.utm_campaign })),
    customSpend,
  });
  const shopifySales = salesResult.rows.reduce((total, row) => total + Number(row.total_sales), 0);

  return NextResponse.json({
    currency: store.currency,
    timezone: store.timezone || "UTC",
    model,
    period: { from, to },
    hasData: dayResult.rows.length > 0,
    synced: stateResult.data ? { at: stateResult.data.synced_at, backfilledFrom: stateResult.data.backfilled_from } : null,
    shopifySales,
    attributedShare: shopifySales > 0 ? Math.min(1, performance.totals.sales / shopifySales) : null,
    spendCoverage: coverage.summary(),
    ...performance,
  });
}
