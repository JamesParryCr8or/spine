create table if not exists public.meta_campaign_insights_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id text not null,
  account_name text,
  campaign_id text not null,
  campaign_name text not null,
  date_start date not null,
  date_stop date not null,
  spend numeric(19,4) not null default 0 check (spend >= 0),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  unique (store_id, account_id, campaign_id, date_start)
);

create index if not exists meta_campaign_insights_store_date_idx
  on public.meta_campaign_insights_daily (store_id, date_start, campaign_id);
create index if not exists meta_campaign_insights_organization_id_idx
  on public.meta_campaign_insights_daily (organization_id);

alter table public.meta_campaign_insights_daily enable row level security;
revoke all on public.meta_campaign_insights_daily from anon, authenticated;
grant select, insert, update on public.meta_campaign_insights_daily to authenticated;

create policy meta_campaign_insights_select_member on public.meta_campaign_insights_daily
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy meta_campaign_insights_insert_admin on public.meta_campaign_insights_daily
  for insert to authenticated with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy meta_campaign_insights_update_admin on public.meta_campaign_insights_daily
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create table if not exists public.campaign_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  platform text not null check (platform in ('meta','google_ads','custom')),
  external_campaign_id text not null,
  external_campaign_name text not null,
  utm_source text not null,
  utm_medium text not null,
  utm_campaign text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, platform, external_campaign_id)
);

create index if not exists campaign_mappings_store_target_idx
  on public.campaign_mappings (store_id, utm_source, utm_medium, utm_campaign);
create index if not exists campaign_mappings_organization_id_idx
  on public.campaign_mappings (organization_id);
create index if not exists campaign_mappings_created_by_idx
  on public.campaign_mappings (created_by);

alter table public.campaign_mappings enable row level security;
revoke all on public.campaign_mappings from anon, authenticated;
grant select, insert, update, delete on public.campaign_mappings to authenticated;

create policy campaign_mappings_select_member on public.campaign_mappings
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy campaign_mappings_insert_admin on public.campaign_mappings
  for insert to authenticated
  with check (created_by = (select auth.uid()) and (select private.is_org_member(organization_id, array['owner','admin'])));
create policy campaign_mappings_update_admin on public.campaign_mappings
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy campaign_mappings_delete_admin on public.campaign_mappings
  for delete to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])));
