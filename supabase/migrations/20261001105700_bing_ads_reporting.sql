alter table public.data_connections drop constraint if exists data_connections_provider_check;
alter table public.data_connections add constraint data_connections_provider_check
  check (provider in ('shopify','meta','google_ads','bing_ads','klaviyo','gohighlevel','stripe','google_sheets'));
alter table public.connection_secret_audit_events drop constraint if exists connection_secret_audit_events_provider_check;
alter table public.connection_secret_audit_events add constraint connection_secret_audit_events_provider_check
  check (provider in ('shopify','meta','google_ads','bing_ads','klaviyo','gohighlevel','stripe','google_sheets'));

do $$ declare definition text; begin
  select pg_get_functiondef('public.save_data_connection(text,uuid,text,text,text)'::regprocedure) into definition;
  definition := regexp_replace(definition, '(connection_provider not in \()([^)]*)(\))', E'\\1\\2, ''bing_ads''\\3');
  definition := replace(definition, 'and membership.role in (''owner'', ''admin'');', 'and (membership.role in (''owner'', ''admin'') or (connection_provider = ''bing_ads'' and membership.role = ''connector''));');
  if definition not like '%''bing_ads''%' then raise exception 'Unexpected save_data_connection definition'; end if;
  execute definition;
end $$;

create table if not exists public.bing_ads_insights_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id text not null,
  account_name text,
  insight_date date not null,
  spend numeric(18, 6) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  unique (store_id, account_id, insight_date)
);
create index if not exists bing_ads_insights_daily_store_date_idx
  on public.bing_ads_insights_daily (organization_id, store_id, insight_date);
alter table public.bing_ads_insights_daily enable row level security;
revoke all on public.bing_ads_insights_daily from anon, authenticated;
grant select, insert, update, delete on public.bing_ads_insights_daily to authenticated;
create policy bing_ads_insights_daily_select_member on public.bing_ads_insights_daily
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy bing_ads_insights_daily_insert_admin on public.bing_ads_insights_daily
  for insert to authenticated with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy bing_ads_insights_daily_update_admin on public.bing_ads_insights_daily
  for update to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));
create policy bing_ads_insights_daily_delete_admin on public.bing_ads_insights_daily
  for delete to authenticated using ((select private.is_org_member(organization_id, array['owner','admin'])));

create table if not exists public.bing_ads_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id text not null,
  customer_id text not null,
  name text not null,
  account_number text,
  currency text,
  status text,
  is_selected boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (store_id, account_id)
);
alter table public.bing_ads_accounts enable row level security;
revoke all on public.bing_ads_accounts from anon, authenticated;
grant select, insert, update, delete on public.bing_ads_accounts to authenticated;
create policy bing_ads_accounts_select_member on public.bing_ads_accounts
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy bing_ads_accounts_insert_admin on public.bing_ads_accounts
  for insert to authenticated with check ((select private.is_org_member(organization_id, array['owner','admin','connector'])));
create policy bing_ads_accounts_update_admin on public.bing_ads_accounts
  for update to authenticated using ((select private.is_org_member(organization_id, array['owner','admin','connector'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin','connector'])));
create policy bing_ads_accounts_delete_admin on public.bing_ads_accounts
  for delete to authenticated using ((select private.is_org_member(organization_id, array['owner','admin','connector'])));

create or replace function public.select_bing_ads_connection(requested_store_id uuid, selected_account_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_org uuid; selected_account public.bing_ads_accounts%rowtype; saved public.data_connections%rowtype;
begin
  select s.organization_id into target_org from public.stores s
    join public.organization_members m on m.organization_id=s.organization_id
    where s.id=requested_store_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','connector');
  if target_org is null then raise exception 'Workspace connector access required'; end if;
  select * into selected_account from public.bing_ads_accounts where store_id=requested_store_id and account_id=selected_account_id;
  if selected_account.id is null then raise exception 'Choose an available Microsoft Advertising account'; end if;
  update public.bing_ads_accounts set is_selected=(account_id=selected_account_id) where store_id=requested_store_id;
  delete from public.bing_ads_insights_daily where store_id=requested_store_id and account_id<>selected_account_id;
  update public.data_connections set external_account_id=selected_account.account_id, external_account_name=selected_account.name,
    last_error=null,updated_at=now() where organization_id=target_org and store_id=requested_store_id and provider='bing_ads' returning * into saved;
  if saved.id is null then raise exception 'Microsoft Advertising is not connected'; end if;
  return jsonb_build_object('provider',saved.provider,'status',saved.status,'external_account_id',saved.external_account_id,'external_account_name',saved.external_account_name);
end $$;
revoke all on function public.select_bing_ads_connection(uuid,text) from public,anon;
grant execute on function public.select_bing_ads_connection(uuid,text) to authenticated;

create or replace function public.rotate_bing_ads_secret(requested_store_id uuid, secret_payload text)
returns void language plpgsql security definer set search_path='' as $$
declare target_org uuid; target_connection public.data_connections%rowtype; new_secret uuid;
begin
  if secret_payload is null or length(secret_payload)=0 then raise exception 'Secret is required'; end if;
  select organization_id into target_org from public.data_connections where store_id=requested_store_id and provider='bing_ads' and status='connected' for update;
  if target_org is null then raise exception 'Microsoft Advertising is not connected'; end if;
  select * into target_connection from public.data_connections where store_id=requested_store_id and provider='bing_ads' for update;
  select vault.create_secret(secret_payload,'connection_'||gen_random_uuid()::text,'bing_ads access token') into new_secret;
  update public.data_connections set vault_secret_id=new_secret, updated_at=now() where id=target_connection.id;
  perform vault.delete_secret(target_connection.vault_secret_id);
end $$;
revoke all on function public.rotate_bing_ads_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.rotate_bing_ads_secret(uuid,text) to service_role;

