create table if not exists public.product_shipping_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid references public.shopify_variants(id) on delete cascade,
  sku text,
  cost_key text not null,
  allocation_basis text not null default 'units' check (allocation_basis in ('orders', 'units')),
  amount numeric(19,4) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (variant_id is not null or length(trim(sku)) > 0),
  check (effective_to is null or effective_to >= effective_from),
  unique (store_id, cost_key, allocation_basis, effective_from)
);

create index if not exists product_shipping_costs_store_effective_idx
  on public.product_shipping_costs (organization_id, store_id, effective_from desc, effective_to);
create index if not exists product_shipping_costs_variant_idx
  on public.product_shipping_costs (variant_id, effective_from desc);
create index if not exists product_shipping_costs_created_by_idx
  on public.product_shipping_costs (created_by);

alter table public.product_shipping_costs enable row level security;
revoke all on public.product_shipping_costs from anon, authenticated;
grant select, insert, update, delete on public.product_shipping_costs to authenticated;

create policy product_shipping_costs_select_member on public.product_shipping_costs
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy product_shipping_costs_insert_admin on public.product_shipping_costs
  for insert to authenticated
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy product_shipping_costs_update_admin on public.product_shipping_costs
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy product_shipping_costs_delete_admin on public.product_shipping_costs
  for delete to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])));
