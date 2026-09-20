create table if not exists public.shopify_acquisition_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sales_date date not null,
  new_customers integer not null default 0 check (new_customers >= 0),
  new_customer_sales numeric(18,2) not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  primary key (store_id, sales_date)
);

create index if not exists shopify_acquisition_daily_org_store_date_idx
  on public.shopify_acquisition_daily (organization_id, store_id, sales_date desc);

alter table public.shopify_acquisition_daily enable row level security;

create policy shopify_acquisition_daily_select_member
on public.shopify_acquisition_daily for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy shopify_acquisition_daily_insert_admin
on public.shopify_acquisition_daily for insert to authenticated
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy shopify_acquisition_daily_update_admin
on public.shopify_acquisition_daily for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

create policy shopify_acquisition_daily_delete_admin
on public.shopify_acquisition_daily for delete to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])));

grant select, insert, update, delete on public.shopify_acquisition_daily to authenticated;