alter table public.data_connections
  add column if not exists granted_scopes text[] not null default '{}'::text[];

create or replace function public.record_shopify_connection_scopes(scopes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_organization_id uuid;
declare target_store_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select organization_id into target_organization_id
  from public.organization_members
  where user_id = (select auth.uid()) and role in ('owner', 'admin')
  order by created_at limit 1;
  if target_organization_id is null then raise exception 'No authorized organization found'; end if;
  select id into target_store_id from public.stores where organization_id = target_organization_id order by created_at limit 1;
  update public.data_connections
  set granted_scopes = coalesce(scopes, '{}'::text[]), updated_at = now()
  where organization_id = target_organization_id and store_id is not distinct from target_store_id and provider = 'shopify';
end;
$$;

revoke all on function public.record_shopify_connection_scopes(text[]) from public, anon;
grant execute on function public.record_shopify_connection_scopes(text[]) to authenticated;