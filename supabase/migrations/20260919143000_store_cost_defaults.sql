-- Store-level fulfilment and postage defaults used by profit reporting.\n\ncreate table if not exists public.store_cost_defaults (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fulfilment_amount numeric(19,4) not null default 0 check (fulfilment_amount >= 0),
  fulfilment_basis text not null default 'orders' check (fulfilment_basis in ('orders', 'units')),
  postage_amount numeric(19,4) not null default 0 check (postage_amount >= 0),
  postage_basis text not null default 'orders' check (postage_basis in ('orders', 'units')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_cost_defaults_organization_idx
  on public.store_cost_defaults (organization_id);

alter table public.store_cost_defaults enable row level security;
revoke all on public.store_cost_defaults from anon, authenticated;
grant select, insert, update, delete on public.store_cost_defaults to authenticated;

create policy store_cost_defaults_select_member on public.store_cost_defaults
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy store_cost_defaults_insert_admin on public.store_cost_defaults
  for insert to authenticated
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy store_cost_defaults_update_admin on public.store_cost_defaults
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy store_cost_defaults_delete_admin on public.store_cost_defaults
  for delete to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])));\n