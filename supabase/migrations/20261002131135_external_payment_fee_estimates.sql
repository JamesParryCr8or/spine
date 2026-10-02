create table public.shopify_payment_gateway_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  payment_date date not null,
  gateway text not null,
  gross_payments numeric(18,2) not null default 0,
  transactions integer not null default 0 check (transactions >= 0),
  currency text not null,
  synced_at timestamptz not null default now(),
  primary key (store_id, payment_date, gateway)
);
create index shopify_payment_gateway_daily_store_date_idx on public.shopify_payment_gateway_daily (store_id, payment_date);
alter table public.shopify_payment_gateway_daily enable row level security;
grant select on public.shopify_payment_gateway_daily to authenticated;
create policy shopify_payment_gateway_daily_read on public.shopify_payment_gateway_daily
  for select to authenticated using (private.has_store_membership(store_id) or private.is_org_member(organization_id, array['owner','admin']));

create table public.payment_fee_estimate_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid primary key references public.stores(id) on delete cascade,
  shopify_plan text,
  plan_override text check (plan_override in ('Basic','Grow','Advanced','Plus')),
  default_percentage_rate numeric(9,6) not null default 2 check (default_percentage_rate >= 0),
  default_fixed_fee numeric(19,4) not null default 0.23 check (default_fixed_fee >= 0),
  surcharge_rate_override numeric(9,6) check (surcharge_rate_override >= 0),
  gateway_synced_from date,
  gateway_synced_to date,
  gateway_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.payment_fee_estimate_settings enable row level security;
grant select, insert, update on public.payment_fee_estimate_settings to authenticated;
create policy payment_fee_estimate_settings_read on public.payment_fee_estimate_settings
  for select to authenticated using (private.has_store_membership(store_id) or private.is_org_member(organization_id, array['owner','admin']));
create policy payment_fee_estimate_settings_insert on public.payment_fee_estimate_settings
  for insert to authenticated with check (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));
create policy payment_fee_estimate_settings_update on public.payment_fee_estimate_settings
  for update to authenticated using (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']))
  with check (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));
