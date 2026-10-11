-- Campaign-level Google Ads spend, alongside the account-level table. Lets the
-- UTM screen match a campaign's spend to its UTM campaign (Google links carry
-- the numeric campaign ID, which is stored here as campaign_id).

create table if not exists public.google_ads_campaign_insights_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null,
  campaign_id text not null,
  campaign_name text not null,
  insight_date date not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  unique (store_id, customer_id, campaign_id, insight_date)
);

create index if not exists google_ads_campaign_insights_daily_store_date_idx
  on public.google_ads_campaign_insights_daily (organization_id, store_id, insight_date);

alter table public.google_ads_campaign_insights_daily enable row level security;
revoke all on public.google_ads_campaign_insights_daily from anon, authenticated;
grant select on public.google_ads_campaign_insights_daily to authenticated;

-- Written by the server (service role) during the reporting refresh; members read their own stores.
create policy google_ads_campaign_insights_daily_select_member
on public.google_ads_campaign_insights_daily for select to authenticated
using ((select private.is_org_member(organization_id)));
