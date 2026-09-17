-- Recurring and one-off operating costs, secured to the owning organization.

create table if not exists public.custom_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null check (category in ('software', 'agency', 'payroll', 'warehouse', 'rent', 'creative', 'fulfilment', 'duties', 'other')),
  amount numeric(19,4) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cadence text not null check (cadence in ('one_off', 'daily', 'weekly', 'monthly', 'annual')),
  allocation_basis text not null default 'fixed' check (allocation_basis in ('fixed', 'orders', 'units', 'revenue')),
  effective_from date not null,
  effective_to date,
  tax_inclusive boolean not null default false,
  notes text,
  external_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists custom_costs_store_effective_idx on public.custom_costs(organization_id, store_id, effective_from desc, effective_to);

alter table public.custom_costs enable row level security;
revoke all on public.custom_costs from anon, authenticated;
grant select, insert, update, delete on public.custom_costs to authenticated;

drop policy if exists "custom_costs_select_member" on public.custom_costs;
create policy "custom_costs_select_member" on public.custom_costs for select to authenticated
using ((select private.is_org_member(organization_id)));

drop policy if exists "custom_costs_insert_admin" on public.custom_costs;
create policy "custom_costs_insert_admin" on public.custom_costs for insert to authenticated
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists "custom_costs_update_admin" on public.custom_costs;
create policy "custom_costs_update_admin" on public.custom_costs for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists "custom_costs_delete_admin" on public.custom_costs;
create policy "custom_costs_delete_admin" on public.custom_costs for delete to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])));