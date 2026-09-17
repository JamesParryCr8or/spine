-- Daily Meta Ads spend imported from the connected ad account.
-- Spend stays at account-day grain so the P&L can align it exactly to its selected period.

create table if not exists public.meta_ad_insights_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id text not null,
  account_name text,
  date_start date not null,
  date_stop date not null,
  spend numeric(19,4) not null default 0 check (spend >= 0),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  unique (store_id, account_id, date_start)
);

create index if not exists meta_ad_insights_daily_store_date_idx
  on public.meta_ad_insights_daily (organization_id, store_id, date_start);

alter table public.meta_ad_insights_daily enable row level security;
revoke all on public.meta_ad_insights_daily from anon;
grant select, insert, update on public.meta_ad_insights_daily to authenticated;

drop policy if exists meta_ad_insights_daily_select_member on public.meta_ad_insights_daily;
create policy meta_ad_insights_daily_select_member on public.meta_ad_insights_daily
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists meta_ad_insights_daily_insert_admin on public.meta_ad_insights_daily;
create policy meta_ad_insights_daily_insert_admin on public.meta_ad_insights_daily
  for insert to authenticated
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists meta_ad_insights_daily_update_admin on public.meta_ad_insights_daily;
create policy meta_ad_insights_daily_update_admin on public.meta_ad_insights_daily
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));
