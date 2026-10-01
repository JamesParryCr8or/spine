-- Reuse the existing Vault secret when Microsoft rotates its refresh token.
-- This project exposes vault.update_secret, not vault.delete_secret.
create or replace function public.rotate_bing_ads_secret(requested_store_id uuid, secret_payload text)
returns void language plpgsql security definer set search_path='' as $$
declare target_connection public.data_connections%rowtype;
begin
  if secret_payload is null or length(secret_payload) = 0 then
    raise exception 'Secret is required';
  end if;

  select * into target_connection
  from public.data_connections
  where store_id = requested_store_id and provider = 'bing_ads' and status = 'connected'
  for update;
  if target_connection.id is null then
    raise exception 'Microsoft Advertising is not connected';
  end if;

  if target_connection.vault_secret_id is null then
    update public.data_connections
    set vault_secret_id = vault.create_secret(secret_payload, 'connection_' || gen_random_uuid()::text, 'bing_ads access token'),
        updated_at = now()
    where id = target_connection.id;
  else
    perform vault.update_secret(target_connection.vault_secret_id, secret_payload);
    update public.data_connections set updated_at = now() where id = target_connection.id;
  end if;
end $$;

revoke all on function public.rotate_bing_ads_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.rotate_bing_ads_secret(uuid,text) to service_role;
