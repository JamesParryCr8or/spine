create table if not exists public.payment_fee_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  gateway text not null check (length(trim(gateway)) > 0),
  percentage_rate numeric(9,6) not null default 0 check (percentage_rate >= 0),
  fixed_fee numeric(19,4) not null default 0 check (fixed_fee >= 0),
  tax_rate numeric(9,6) not null default 0 check (tax_rate >= 0),
  minimum_fee numeric(19,4) not null default 0 check (minimum_fee >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (store_id, gateway, currency, effective_from)
);

create index if not exists payment_fee_rules_store_effective_idx
  on public.payment_fee_rules (organization_id, store_id, gateway, currency, effective_from desc, effective_to);
create index if not exists payment_fee_rules_store_id_idx on public.payment_fee_rules (store_id);
create index if not exists payment_fee_rules_created_by_idx on public.payment_fee_rules (created_by);

alter table public.payment_fee_rules enable row level security;
revoke all on public.payment_fee_rules from anon, authenticated;
grant select, insert, update, delete on public.payment_fee_rules to authenticated;

drop policy if exists payment_fee_rules_select_member on public.payment_fee_rules;
create policy payment_fee_rules_select_member on public.payment_fee_rules
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists payment_fee_rules_insert_admin on public.payment_fee_rules;
create policy payment_fee_rules_insert_admin on public.payment_fee_rules
  for insert to authenticated
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists payment_fee_rules_update_admin on public.payment_fee_rules;
create policy payment_fee_rules_update_admin on public.payment_fee_rules
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists payment_fee_rules_delete_admin on public.payment_fee_rules;
create policy payment_fee_rules_delete_admin on public.payment_fee_rules
  for delete to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])));
