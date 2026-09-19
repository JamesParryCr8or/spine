create or replace function public.read_connection_secret(
  requested_store_id uuid,
  connection_provider text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_value text;
begin
  select decrypted.decrypted_secret into secret_value
  from public.data_connections connection
  join public.organization_members membership
    on membership.organization_id = connection.organization_id
  join vault.decrypted_secrets decrypted
    on decrypted.id = connection.vault_secret_id
  where connection.store_id = requested_store_id
    and connection.provider = connection_provider
    and connection.status = 'connected'
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin');

  return secret_value;
end;
$$;

revoke all on function public.read_connection_secret(uuid, text) from public, anon;
grant execute on function public.read_connection_secret(uuid, text) to authenticated;

create table if not exists public.google_ads_insights_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null,
  customer_name text,
  insight_date date not null,
  spend numeric(18, 6) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  unique (store_id, customer_id, insight_date)
);

create index if not exists google_ads_insights_daily_store_date_idx
  on public.google_ads_insights_daily (organization_id, store_id, insight_date);

alter table public.google_ads_insights_daily enable row level security;
revoke all on public.google_ads_insights_daily from anon, authenticated;
grant select, insert, update, delete on public.google_ads_insights_daily to authenticated;

create policy google_ads_insights_daily_select_member on public.google_ads_insights_daily
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy google_ads_insights_daily_insert_admin on public.google_ads_insights_daily
  for insert to authenticated with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy google_ads_insights_daily_update_admin on public.google_ads_insights_daily
  for update to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy google_ads_insights_daily_delete_admin on public.google_ads_insights_daily
  for delete to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])));

