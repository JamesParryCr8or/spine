create extension if not exists pgcrypto;
create extension if not exists supabase_vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  shopify_domain text,
  timezone text not null default 'Europe/London',
  currency text not null default 'GBP',
  reporting_currency text not null default 'GBP',
  business_model text not null default 'ecommerce' check (business_model in ('ecommerce', 'lead_generation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  provider text not null check (provider in ('shopify', 'meta', 'google_ads', 'klaviyo')),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  external_account_id text,
  external_account_name text,
  vault_secret_id uuid not null,
  created_by uuid not null references auth.users(id),
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, store_id, provider)
);

create index if not exists organization_members_user_idx on public.organization_members(user_id, organization_id);
create index if not exists organizations_created_by_idx on public.organizations(created_by);
create index if not exists stores_organization_idx on public.stores(organization_id);
create index if not exists data_connections_organization_idx on public.data_connections(organization_id, provider);
create index if not exists data_connections_store_idx on public.data_connections(store_id);
create index if not exists data_connections_created_by_idx on public.data_connections(created_by);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.stores enable row level security;
alter table public.data_connections enable row level security;

revoke all on public.profiles, public.organizations, public.organization_members, public.stores, public.data_connections from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select, insert, update, delete on public.stores to authenticated;
grant select on public.data_connections to authenticated;

create or replace function private.is_org_member(target_organization_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and (allowed_roles is null or membership.role = any(allowed_roles))
  );
$$;

revoke all on function private.is_org_member(uuid, text[]) from public;
grant execute on function private.is_org_member(uuid, text[]) to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations for select to authenticated
using ((select private.is_org_member(id)));
drop policy if exists "organizations_update_admin" on public.organizations;
create policy "organizations_update_admin" on public.organizations for update to authenticated
using ((select private.is_org_member(id, array['owner','admin'])))
with check ((select private.is_org_member(id, array['owner','admin'])));

drop policy if exists "members_select_member" on public.organization_members;
create policy "members_select_member" on public.organization_members for select to authenticated
using ((select private.is_org_member(organization_id)));

drop policy if exists "stores_select_member" on public.stores;
create policy "stores_select_member" on public.stores for select to authenticated
using ((select private.is_org_member(organization_id)));
drop policy if exists "stores_insert_admin" on public.stores;
create policy "stores_insert_admin" on public.stores for insert to authenticated
with check ((select private.is_org_member(organization_id, array['owner','admin'])));
drop policy if exists "stores_update_admin" on public.stores;
create policy "stores_update_admin" on public.stores for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));
drop policy if exists "stores_delete_owner" on public.stores;
create policy "stores_delete_owner" on public.stores for delete to authenticated
using ((select private.is_org_member(organization_id, array['owner'])));

drop policy if exists "connections_select_member" on public.data_connections;
create policy "connections_select_member" on public.data_connections for select to authenticated
using ((select private.is_org_member(organization_id)));

create or replace function private.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;

  if not exists (select 1 from public.organization_members where user_id = new.id) then
    insert into public.organizations (name, created_by)
    values (coalesce(new.raw_user_meta_data ->> 'company_name', 'My ecommerce business'), new.id)
    returning id into new_organization_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (new_organization_id, new.id, 'owner');

    insert into public.stores (organization_id, name)
    values (new_organization_id, 'My Shopify store');
  end if;
  return new;
end;
$$;

revoke all on function private.bootstrap_user() from public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.bootstrap_user();

create or replace function private.bootstrap_user_record(target_user_id uuid, target_email text, target_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare new_organization_id uuid;
begin
  insert into public.profiles (user_id, display_name)
  values (target_user_id, coalesce(target_metadata ->> 'full_name', split_part(target_email, '@', 1)))
  on conflict (user_id) do nothing;
  if not exists (select 1 from public.organization_members where user_id = target_user_id) then
    insert into public.organizations (name, created_by)
    values (coalesce(target_metadata ->> 'company_name', 'My ecommerce business'), target_user_id)
    returning id into new_organization_id;
    insert into public.organization_members (organization_id, user_id, role) values (new_organization_id, target_user_id, 'owner');
    insert into public.stores (organization_id, name) values (new_organization_id, 'My Shopify store');
  end if;
end;
$$;

revoke all on function private.bootstrap_user_record(uuid, text, jsonb) from public;

do $$
declare existing_user auth.users%rowtype;
begin
  for existing_user in select * from auth.users loop
    perform private.bootstrap_user_record(existing_user.id, existing_user.email, existing_user.raw_user_meta_data);
  end loop;
end $$;



create or replace function public.save_data_connection(
  connection_provider text,
  requested_store_id uuid,
  access_token text,
  account_id text default null,
  account_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_organization_id uuid;
  existing_connection public.data_connections%rowtype;
  new_secret_id uuid;
  saved_connection public.data_connections%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if connection_provider not in ('meta', 'shopify', 'google_ads', 'klaviyo') then raise exception 'Unsupported provider'; end if;
  if nullif(trim(access_token), '') is null then raise exception 'Access token is required'; end if;

  select store.organization_id into target_organization_id
  from public.stores store
  join public.organization_members membership
    on membership.organization_id = store.organization_id
  where store.id = requested_store_id
    and membership.user_id = current_user_id
    and membership.role in ('owner', 'admin');

  if target_organization_id is null then
    raise exception 'No authorized store found';
  end if;

  select * into existing_connection
  from public.data_connections connection
  where connection.organization_id = target_organization_id
    and connection.store_id = requested_store_id
    and connection.provider = connection_provider;

  if existing_connection.id is not null then
    perform vault.update_secret(existing_connection.vault_secret_id, trim(access_token));
    update public.data_connections
    set external_account_id = nullif(trim(account_id), ''),
        external_account_name = nullif(trim(account_name), ''),
        status = 'connected',
        last_verified_at = now(),
        last_error = null,
        updated_at = now()
    where id = existing_connection.id
    returning * into saved_connection;
  else
    select vault.create_secret(
      trim(access_token),
      'connection_' || gen_random_uuid()::text,
      connection_provider || ' access token'
    ) into new_secret_id;
    insert into public.data_connections (
      organization_id, store_id, provider, external_account_id,
      external_account_name, vault_secret_id, created_by, last_verified_at
    )
    values (
      target_organization_id, requested_store_id, connection_provider,
      nullif(trim(account_id), ''), nullif(trim(account_name), ''),
      new_secret_id, current_user_id, now()
    )
    returning * into saved_connection;
  end if;

  return jsonb_build_object(
    'provider', saved_connection.provider,
    'status', saved_connection.status,
    'store_id', saved_connection.store_id,
    'external_account_id', saved_connection.external_account_id,
    'external_account_name', saved_connection.external_account_name,
    'last_verified_at', saved_connection.last_verified_at
  );
end;
$$;

revoke all on function public.save_data_connection(text, uuid, text, text, text) from public, anon;
grant execute on function public.save_data_connection(text, uuid, text, text, text) to authenticated;

create or replace function public.delete_data_connection(
  connection_provider text,
  requested_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.data_connections%rowtype;
begin
  select connection.* into target_connection
  from public.data_connections connection
  join public.organization_members membership
    on membership.organization_id = connection.organization_id
  where membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin')
    and connection.store_id = requested_store_id
    and connection.provider = connection_provider;

  if target_connection.id is null then return; end if;
  delete from public.data_connections where id = target_connection.id;
  delete from vault.secrets where id = target_connection.vault_secret_id;
end;
$$;

revoke all on function public.delete_data_connection(text, uuid) from public, anon;
grant execute on function public.delete_data_connection(text, uuid) to authenticated;

create or replace function public.record_shopify_connection_scopes(
  scopes text[],
  requested_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  select store.organization_id into target_organization_id
  from public.stores store
  join public.organization_members membership
    on membership.organization_id = store.organization_id
  where store.id = requested_store_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin');

  if target_organization_id is null then
    raise exception 'No authorized store found';
  end if;

  update public.data_connections
  set granted_scopes = coalesce(scopes, '{}'::text[]), updated_at = now()
  where organization_id = target_organization_id
    and store_id = requested_store_id
    and provider = 'shopify';
end;
$$;

revoke all on function public.record_shopify_connection_scopes(text[], uuid) from public, anon;
grant execute on function public.record_shopify_connection_scopes(text[], uuid) to authenticated;

