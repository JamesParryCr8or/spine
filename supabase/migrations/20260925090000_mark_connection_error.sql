create or replace function public.mark_connection_error(
  connection_provider text,
  requested_store_id uuid,
  connection_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_connection public.data_connections%rowtype;
begin
  if not exists (
    select 1
    from public.stores store
    join public.organization_members membership
      on membership.organization_id = store.organization_id
    where store.id = requested_store_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'No authorized store found';
  end if;

  update public.data_connections
  set status = 'error',
      last_error = left(nullif(trim(connection_error), ''), 1000),
      updated_at = now()
  where store_id = requested_store_id
    and provider = connection_provider
  returning * into saved_connection;

  return jsonb_build_object(
    'provider', saved_connection.provider,
    'status', saved_connection.status,
    'external_account_id', saved_connection.external_account_id,
    'external_account_name', saved_connection.external_account_name,
    'last_verified_at', saved_connection.last_verified_at,
    'last_error', saved_connection.last_error
  );
end;
$$;

revoke all on function public.mark_connection_error(text, uuid, text) from public, anon;
grant execute on function public.mark_connection_error(text, uuid, text) to authenticated;
