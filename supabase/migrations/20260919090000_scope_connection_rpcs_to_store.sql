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
