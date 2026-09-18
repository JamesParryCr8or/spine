create table if not exists public.connection_secret_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  connection_id uuid references public.data_connections(id) on delete set null,
  provider text not null check (provider in ('meta', 'shopify', 'google_ads', 'klaviyo')),
  action text not null check (action in ('credential_created', 'credential_rotated', 'connection_deleted', 'scopes_updated')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists connection_secret_audit_org_created_idx on public.connection_secret_audit_events (organization_id, created_at desc);
create index if not exists connection_secret_audit_store_id_idx on public.connection_secret_audit_events (store_id);
create index if not exists connection_secret_audit_connection_id_idx on public.connection_secret_audit_events (connection_id);
create index if not exists connection_secret_audit_actor_user_id_idx on public.connection_secret_audit_events (actor_user_id);

alter table public.connection_secret_audit_events enable row level security;
revoke all on public.connection_secret_audit_events from anon, authenticated;
grant select on public.connection_secret_audit_events to authenticated;

create policy connection_secret_audit_select_admin on public.connection_secret_audit_events
for select to authenticated
using (exists (
  select 1 from public.organization_members membership
  where membership.organization_id = connection_secret_audit_events.organization_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin')
));

create or replace function public.save_data_connection(connection_provider text, access_token text, account_id text default null, account_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  target_organization_id uuid;
  target_store_id uuid;
  existing_connection public.data_connections%rowtype;
  new_secret_id uuid;
  saved_connection public.data_connections%rowtype;
  audit_action text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if connection_provider not in ('meta', 'shopify', 'google_ads', 'klaviyo') then raise exception 'Unsupported provider'; end if;
  if nullif(trim(access_token), '') is null then raise exception 'Access token is required'; end if;

  select membership.organization_id into target_organization_id
  from public.organization_members membership
  where membership.user_id = current_user_id and membership.role in ('owner', 'admin')
  order by membership.created_at limit 1;
  if target_organization_id is null then raise exception 'No authorized organization found'; end if;

  select id into target_store_id from public.stores where organization_id = target_organization_id order by created_at limit 1;
  select * into existing_connection from public.data_connections
  where organization_id = target_organization_id and store_id is not distinct from target_store_id and provider = connection_provider;

  if existing_connection.id is not null then
    perform vault.update_secret(existing_connection.vault_secret_id, trim(access_token));
    update public.data_connections set external_account_id = nullif(trim(account_id), ''), external_account_name = nullif(trim(account_name), ''), status = 'connected', last_verified_at = now(), last_error = null, updated_at = now()
    where id = existing_connection.id returning * into saved_connection;
    audit_action := 'credential_rotated';
  else
    select vault.create_secret(trim(access_token), 'connection_' || gen_random_uuid()::text, connection_provider || ' access token') into new_secret_id;
    insert into public.data_connections (organization_id, store_id, provider, external_account_id, external_account_name, vault_secret_id, created_by, last_verified_at)
    values (target_organization_id, target_store_id, connection_provider, nullif(trim(account_id), ''), nullif(trim(account_name), ''), new_secret_id, current_user_id, now()) returning * into saved_connection;
    audit_action := 'credential_created';
  end if;

  insert into public.connection_secret_audit_events (organization_id, store_id, connection_id, provider, action, actor_user_id)
  values (target_organization_id, target_store_id, saved_connection.id, connection_provider, audit_action, current_user_id);

  return jsonb_build_object(
    'provider', saved_connection.provider,
    'status', saved_connection.status,
    'external_account_id', saved_connection.external_account_id,
    'external_account_name', saved_connection.external_account_name,
    'last_verified_at', saved_connection.last_verified_at
  );
end;
$function$;

create or replace function public.delete_data_connection(connection_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  target_connection public.data_connections%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select connection.* into target_connection from public.data_connections connection
  join public.organization_members membership on membership.organization_id = connection.organization_id
  where membership.user_id = current_user_id and membership.role in ('owner','admin') and connection.provider = connection_provider
  order by connection.created_at limit 1;
  if target_connection.id is null then return; end if;

  insert into public.connection_secret_audit_events (organization_id, store_id, connection_id, provider, action, actor_user_id)
  values (target_connection.organization_id, target_connection.store_id, target_connection.id, target_connection.provider, 'connection_deleted', current_user_id);

  delete from public.data_connections where id = target_connection.id;
  delete from vault.secrets where id = target_connection.vault_secret_id;
end;
$function$;

create or replace function public.record_shopify_connection_scopes(scopes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  target_organization_id uuid;
  target_store_id uuid;
  target_connection_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select organization_id into target_organization_id
  from public.organization_members
  where user_id = current_user_id and role in ('owner', 'admin')
  order by created_at limit 1;
  if target_organization_id is null then raise exception 'No authorized organization found'; end if;
  select id into target_store_id from public.stores where organization_id = target_organization_id order by created_at limit 1;

  update public.data_connections
  set granted_scopes = coalesce(scopes, '{}'::text[]), updated_at = now()
  where organization_id = target_organization_id and store_id is not distinct from target_store_id and provider = 'shopify'
  returning id into target_connection_id;

  if target_connection_id is not null then
    insert into public.connection_secret_audit_events (organization_id, store_id, connection_id, provider, action, actor_user_id, metadata)
    values (target_organization_id, target_store_id, target_connection_id, 'shopify', 'scopes_updated', current_user_id, jsonb_build_object('scope_count', cardinality(coalesce(scopes, '{}'::text[]))));
  end if;
end;
$function$;
