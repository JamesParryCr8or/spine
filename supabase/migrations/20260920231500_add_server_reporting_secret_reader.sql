-- Server-side reporting jobs are authorized by the workspace check in their route.
-- This RPC is intentionally executable only by the Supabase service role.
create or replace function public.read_connection_secret_for_server(
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
  select decrypted.decrypted_secret
    into secret_value
  from public.data_connections as connection
  join vault.decrypted_secrets as decrypted
    on decrypted.id = connection.vault_secret_id
  where connection.store_id = requested_store_id
    and connection.provider = connection_provider
    and connection.status = 'connected';

  return secret_value;
end;
$$;

revoke all on function public.read_connection_secret_for_server(uuid, text) from public, anon, authenticated;
grant execute on function public.read_connection_secret_for_server(uuid, text) to service_role;
