import { NextResponse } from "next/server";

import { parseCampaignMapping, parseCampaignMappingId } from "@/lib/settings/campaign-mapping-schema";
import { createClient } from "@/lib/supabase/server";

const mappingFields = "id,platform,external_campaign_id,external_campaign_name,utm_source,utm_medium,utm_campaign,updated_at";

async function context() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { data: membership } = await supabase.from("organization_members").select("organization_id,role").eq("user_id", userId).limit(1).single();
  if (!membership) return { error: NextResponse.json({ error: "No workspace is configured" }, { status: 403 }) };
  const { data: store } = await supabase.from("stores").select("id").eq("organization_id", membership.organization_id).limit(1).single();
  if (!store) return { error: NextResponse.json({ error: "No store is configured" }, { status: 404 }) };
  return { supabase, userId, membership, store };
}

export async function GET() {
  const result = await context();
  if (result.error) return result.error;
  const [mappingResult, campaignResult] = await Promise.all([
    result.supabase.from("campaign_mappings").select(mappingFields).eq("store_id", result.store.id).order("external_campaign_name"),
    result.supabase.from("meta_campaign_insights_daily").select("campaign_id,campaign_name,account_id,account_name,currency").eq("store_id", result.store.id).order("campaign_name"),
  ]);
  const error = mappingResult.error ?? campaignResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const campaigns = [...new Map((campaignResult.data ?? []).map((campaign) => [campaign.campaign_id, campaign])).values()];
  return NextResponse.json({ canManage: result.membership.role === "owner" || result.membership.role === "admin", mappings: mappingResult.data ?? [], campaigns });
}

export async function POST(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const parsed = parseCampaignMapping(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data: campaign, error: campaignError } = await result.supabase.from("meta_campaign_insights_daily").select("campaign_id,campaign_name").eq("store_id", result.store.id).eq("campaign_id", parsed.value.externalCampaignId).limit(1).maybeSingle();
  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: "Choose an imported Meta campaign" }, { status: 400 });
  const { data, error } = await result.supabase.from("campaign_mappings").upsert({
    organization_id: result.membership.organization_id,
    store_id: result.store.id,
    platform: "meta",
    external_campaign_id: campaign.campaign_id,
    external_campaign_name: campaign.campaign_name,
    utm_source: parsed.value.utmSource,
    utm_medium: parsed.value.utmMedium,
    utm_campaign: parsed.value.utmCampaign,
    created_by: result.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "store_id,platform,external_campaign_id" }).select(mappingFields).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mapping: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const result = await context();
  if (result.error) return result.error;
  if (result.membership.role !== "owner" && result.membership.role !== "admin") return NextResponse.json({ error: "Owner or admin access is required" }, { status: 403 });
  const parsed = parseCampaignMappingId(new URL(request.url).searchParams.get("id"));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { error } = await result.supabase.from("campaign_mappings").delete().eq("id", parsed.value.id).eq("store_id", result.store.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
