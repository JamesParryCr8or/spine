create table if not exists public.product_cost_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_cost_id uuid,
  action text not null check (action in ('created', 'updated', 'deleted')),
  previous_value jsonb,
  next_value jsonb,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists product_cost_audit_store_created_idx
  on public.product_cost_audit_events (organization_id, store_id, created_at desc);

alter table public.product_cost_audit_events enable row level security;
revoke all on public.product_cost_audit_events from anon, authenticated;
grant select on public.product_cost_audit_events to authenticated;

drop policy if exists product_cost_audit_select_member on public.product_cost_audit_events;
create policy product_cost_audit_select_member on public.product_cost_audit_events
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create or replace function private.audit_product_cost_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.product_cost_audit_events (organization_id, store_id, product_cost_id, action, next_value, changed_by)
    values (new.organization_id, new.store_id, new.id, 'created', to_jsonb(new), (select auth.uid()));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.product_cost_audit_events (organization_id, store_id, product_cost_id, action, previous_value, next_value, changed_by)
    values (new.organization_id, new.store_id, new.id, 'updated', to_jsonb(old), to_jsonb(new), (select auth.uid()));
    return new;
  else
    insert into public.product_cost_audit_events (organization_id, store_id, product_cost_id, action, previous_value, changed_by)
    values (old.organization_id, old.store_id, old.id, 'deleted', to_jsonb(old), (select auth.uid()));
    return old;
  end if;
end;
$$;

revoke all on function private.audit_product_cost_change() from public;

drop trigger if exists product_cost_audit_trigger on public.product_costs;
create trigger product_cost_audit_trigger
after insert or update or delete on public.product_costs
for each row execute function private.audit_product_cost_change();