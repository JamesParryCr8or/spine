create table if not exists public.google_ads_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null check (customer_id ~ '^[0-9]{1,20}$'),
  name text not null,
  is_manager boolean not null default false,
  hierarchy_level integer not null default 0 check (hierarchy_level >= 0),
  direct_access boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, customer_id)
);

create index if not exists google_ads_accounts_store_idx on public.google_ads_accounts (organization_id, store_id, is_manager, hierarchy_level, name);

alter table public.google_ads_accounts enable row level security;
revoke all on public.google_ads_accounts from anon, authenticated;
grant select, insert, update, delete on public.google_ads_accounts to authenticated;

create policy google_ads_accounts_select_member on public.google_ads_accounts
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy google_ads_accounts_insert_admin on public.google_ads_accounts
  for insert to authenticated with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy google_ads_accounts_update_admin on public.google_ads_accounts
  for update to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy google_ads_accounts_delete_admin on public.google_ads_accounts
  for delete to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])));

create or replace function public.select_google_ads_connection(
  requested_store_id uuid,
  selected_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_organization_id uuid;
  selected_account public.google_ads_accounts%rowtype;
  saved_connection public.data_connections%rowtype;
begin
  select store.organization_id into target_organization_id
  from public.stores store
  join public.organization_members membership on membership.organization_id = store.organization_id
  where store.id = requested_store_id
    and membership.user_id = current_user_id
    and membership.role in ('owner', 'admin');

  if target_organization_id is null then raise exception 'No authorized store found'; end if;

  select * into selected_account
  from public.google_ads_accounts
  where store_id = requested_store_id
    and customer_id = regexp_replace(selected_customer_id, '\D', '', 'g');

  if selected_account.id is null then raise exception 'Google Ads account was not found for this store'; end if;

  update public.data_connections
  set external_account_id = selected_account.customer_id,
      external_account_name = selected_account.name,
      status = 'connected',
      last_verified_at = now(),
      last_error = null,
      updated_at = now()
  where organization_id = target_organization_id
    and store_id = requested_store_id
    and provider = 'google_ads'
  returning * into saved_connection;

  if saved_connection.id is null then raise exception 'Google Ads is not connected'; end if;

  return jsonb_build_object(
    'provider', saved_connection.provider,
    'status', saved_connection.status,
    'external_account_id', saved_connection.external_account_id,
    'external_account_name', saved_connection.external_account_name,
    'last_verified_at', saved_connection.last_verified_at
  );
end;
$$;

revoke all on function public.select_google_ads_connection(uuid, text) from public, anon;
grant execute on function public.select_google_ads_connection(uuid, text) to authenticated;