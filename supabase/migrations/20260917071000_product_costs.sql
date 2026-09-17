-- Effective-dated product costs and import history.

create table if not exists public.product_cost_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  original_filename text not null,
  status text not null default 'completed' check (status in ('processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  errors jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.product_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid references public.shopify_variants(id) on delete cascade,
  import_batch_id uuid references public.product_cost_import_batches(id) on delete set null,
  cost_key text not null,
  sku text,
  source text not null check (source in ('shopify', 'manual', 'csv', 'google_sheets')),
  amount numeric(19,4) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  notes text,
  external_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (variant_id is not null or nullif(trim(sku), '') is not null),
  check (effective_to is null or effective_to >= effective_from),
  unique (store_id, cost_key, effective_from, source)
);

create index if not exists product_costs_store_effective_idx
  on public.product_costs(organization_id, store_id, effective_from desc, effective_to);
create index if not exists product_costs_variant_idx
  on public.product_costs(variant_id, effective_from desc);
create index if not exists product_cost_batches_store_idx
  on public.product_cost_import_batches(organization_id, store_id, created_at desc);

alter table public.product_costs enable row level security;
alter table public.product_cost_import_batches enable row level security;

revoke all on public.product_costs, public.product_cost_import_batches from anon, authenticated;
grant select, insert, update, delete on public.product_costs to authenticated;
grant select, insert, update on public.product_cost_import_batches to authenticated;

drop policy if exists "product_costs_select_member" on public.product_costs;
create policy "product_costs_select_member" on public.product_costs for select to authenticated
using ((select private.is_org_member(organization_id)));
drop policy if exists "product_costs_insert_admin" on public.product_costs;
create policy "product_costs_insert_admin" on public.product_costs for insert to authenticated
with check ((select private.is_org_member(organization_id, array['owner','admin'])));
drop policy if exists "product_costs_update_admin" on public.product_costs;
create policy "product_costs_update_admin" on public.product_costs for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));
drop policy if exists "product_costs_delete_admin" on public.product_costs;
create policy "product_costs_delete_admin" on public.product_costs for delete to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists "product_cost_batches_select_member" on public.product_cost_import_batches;
create policy "product_cost_batches_select_member" on public.product_cost_import_batches for select to authenticated
using ((select private.is_org_member(organization_id)));
drop policy if exists "product_cost_batches_insert_admin" on public.product_cost_import_batches;
create policy "product_cost_batches_insert_admin" on public.product_cost_import_batches for insert to authenticated
with check ((select private.is_org_member(organization_id, array['owner','admin'])));
drop policy if exists "product_cost_batches_update_admin" on public.product_cost_import_batches;
create policy "product_cost_batches_update_admin" on public.product_cost_import_batches for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));
