-- Set-based store read checks.
--
-- store_scope_read policies called private.has_store_membership(store_id, roles)
-- once per row. Postgres cannot hoist a per-row security-definer call out of the
-- scan, so every row of a large table paid for a membership lookup.
--
-- readable_store_ids() returns the stores the caller may read with the given
-- roles. Written as `store_id in (select private.readable_store_ids(...))`, the
-- subquery is uncorrelated and stable, so Postgres evaluates it once per
-- statement (InitPlan) and turns each row check into a hash/index lookup.
--
-- Only the store_scope_read SELECT policies are rewritten here. Merging them
-- with the older workspace-wide policies into one permissive SELECT policy per
-- table needs an EXPLAIN pass on the live project first, so it is left out.

create or replace function private.readable_store_ids(allowed_roles text[] default null)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select membership.store_id
  from public.store_memberships membership
  where membership.user_id = (select auth.uid())
    and (allowed_roles is null or membership.role = any(allowed_roles));
$$;

revoke all on function private.readable_store_ids(text[]) from public;
grant execute on function private.readable_store_ids(text[]) to authenticated;

do $$
declare
  table_row record;
  read_roles text[];
begin
  for table_row in
    select p.tablename
    from pg_policies p
    where p.schemaname = 'public' and p.policyname = 'store_scope_read'
  loop
    read_roles := array['owner','admin','analyst','connector','viewer'];
    if table_row.tablename in ('shopify_customers','shopify_orders','shopify_order_lines',
      'shopify_refunds','shopify_refund_lines','shopify_transactions','shopify_order_attribution') then
      read_roles := array['owner','admin','analyst','connector'];
    end if;
    if table_row.tablename in ('connection_secret_audit_events', 'product_cost_audit_events') then
      read_roles := array['admin'];
    end if;

    execute format('drop policy store_scope_read on public.%I', table_row.tablename);
    execute format(
      'create policy store_scope_read on public.%I for select to authenticated using (store_id in (select private.readable_store_ids(%L::text[])))',
      table_row.tablename, read_roles
    );
  end loop;
end $$;
