create table if not exists public.shopify_sales_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sales_date date not null,
  gross_sales numeric(18,2) not null default 0,
  discounts numeric(18,2) not null default 0,
  sales_reversals numeric(18,2) not null default 0,
  net_sales numeric(18,2) not null default 0,
  shipping_charges numeric(18,2) not null default 0,
  taxes numeric(18,2) not null default 0,
  total_sales numeric(18,2) not null default 0,
  orders integer not null default 0 check (orders >= 0),
  net_items_sold integer not null default 0,
  cost_of_goods_sold numeric(18,2) not null default 0,
  gross_profit numeric(18,2) not null default 0,
  net_sales_with_cost_recorded numeric(18,2) not null default 0,
  net_sales_without_cost_recorded numeric(18,2) not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  primary key (store_id, sales_date)
);

create index if not exists shopify_sales_daily_org_store_date_idx
  on public.shopify_sales_daily (organization_id, store_id, sales_date desc);

alter table public.shopify_sales_daily enable row level security;

create policy shopify_sales_daily_select_member
on public.shopify_sales_daily for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy shopify_sales_daily_insert_admin
on public.shopify_sales_daily for insert to authenticated
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy shopify_sales_daily_update_admin
on public.shopify_sales_daily for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy shopify_sales_daily_delete_admin
on public.shopify_sales_daily for delete to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])));

grant select, insert, update, delete on public.shopify_sales_daily to authenticated;
