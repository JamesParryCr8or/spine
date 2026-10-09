-- One round trip for requireWorkspace(): returns the caller's organization and
-- store memberships plus every store in those organizations.
--
-- security invoker on purpose: the existing RLS policies on
-- organization_members, store_memberships and stores still decide what is
-- returned, exactly as the three separate queries did before.
create or replace function public.get_workspace_context()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'memberships', coalesce((
      select jsonb_agg(m order by m.created_at)
      from (
        select om.organization_id, om.role, om.created_at, null::uuid as store_id
        from public.organization_members om
        where om.user_id = auth.uid()
        union all
        select s.organization_id, sm.role, sm.created_at, sm.store_id
        from public.store_memberships sm
        join public.stores s on s.id = sm.store_id
        where sm.user_id = auth.uid()
      ) m
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(st order by st.created_at)
      from (
        select s.id, s.organization_id, s.name, s.currency, s.reporting_currency,
               s.timezone, s.shopify_domain, s.business_model, s.created_at
        from public.stores s
        where s.organization_id in (
          select om.organization_id from public.organization_members om where om.user_id = auth.uid()
          union
          select s2.organization_id from public.store_memberships sm2
          join public.stores s2 on s2.id = sm2.store_id
          where sm2.user_id = auth.uid()
        )
      ) st
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_workspace_context() from public, anon;
grant execute on function public.get_workspace_context() to authenticated;
