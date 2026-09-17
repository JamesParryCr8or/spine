create table if not exists public.shopify_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  shopify_gid text not null,
  kind text not null,
  status text not null,
  gateway text,
  formatted_gateway text,
  amount numeric(19,4) not null default 0,
  currency text not null,
  fee_amount numeric(19,4) not null default 0,
  fee_tax numeric(19,4) not null default 0,
  created_at_shopify timestamptz not null,
  processed_at_shopify timestamptz,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create index if not exists shopify_transactions_order_idx
  on public.shopify_transactions (order_id, processed_at_shopify);

alter table public.shopify_transactions enable row level security;
revoke all on public.shopify_transactions from anon, authenticated;
grant select, insert, update on public.shopify_transactions to authenticated;

drop policy if exists shopify_transactions_select_member on public.shopify_transactions;
create policy shopify_transactions_select_member on public.shopify_transactions
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists shopify_transactions_insert_admin on public.shopify_transactions;
create policy shopify_transactions_insert_admin on public.shopify_transactions
  for insert to authenticated
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists shopify_transactions_update_admin on public.shopify_transactions;
create policy shopify_transactions_update_admin on public.shopify_transactions
  for update to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])))
  with check ((select private.is_org_member(organization_id, array['owner','admin'])));