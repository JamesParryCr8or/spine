-- Normalized Shopify catalogue, orders, refunds, customers, attribution, and sync history.
-- All financial values use fixed-precision numeric columns and retain their source currency.

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  source text not null check (source in ('shopify', 'meta', 'google_ads', 'klaviyo', 'manual')),
  resource text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  cursor text,
  records_processed integer not null default 0 check (records_processed >= 0),
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  created_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sync_runs add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.sync_runs add column if not exists created_at timestamptz not null default now();
alter table public.sync_runs add column if not exists updated_at timestamptz not null default now();

create table if not exists public.shopify_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  shopify_gid text not null,
  legacy_resource_id text,
  title text not null,
  handle text not null,
  status text not null,
  vendor text,
  product_type text,
  featured_image_url text,
  created_at_shopify timestamptz not null,
  updated_at_shopify timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.shopify_products(id) on delete cascade,
  shopify_gid text not null,
  legacy_resource_id text,
  title text not null,
  sku text,
  barcode text,
  price numeric(19,4) not null default 0,
  compare_at_price numeric(19,4),
  inventory_quantity integer,
  inventory_item_gid text,
  shopify_unit_cost numeric(19,4),
  currency text not null,
  created_at_shopify timestamptz not null,
  updated_at_shopify timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  shopify_gid text not null,
  legacy_resource_id text,
  display_name text,
  email text,
  number_of_orders bigint not null default 0,
  amount_spent numeric(19,4) not null default 0,
  currency text not null,
  created_at_shopify timestamptz not null,
  updated_at_shopify timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid references public.shopify_customers(id) on delete set null,
  shopify_gid text not null,
  legacy_resource_id text,
  order_name text not null,
  financial_status text,
  fulfillment_status text,
  source_name text,
  test boolean not null default false,
  cancelled_at timestamptz,
  processed_at timestamptz,
  created_at_shopify timestamptz not null,
  updated_at_shopify timestamptz not null,
  currency text not null,
  presentment_currency text not null,
  gross_sales numeric(19,4) not null default 0,
  discounts numeric(19,4) not null default 0,
  net_product_sales numeric(19,4) not null default 0,
  shipping_revenue numeric(19,4) not null default 0,
  tax numeric(19,4) not null default 0,
  duties numeric(19,4) not null default 0,
  total_sales numeric(19,4) not null default 0,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  shopify_gid text not null,
  product_gid text,
  variant_gid text,
  title text not null,
  variant_title text,
  sku text,
  vendor text,
  quantity integer not null,
  current_quantity integer not null,
  unit_price numeric(19,4) not null default 0,
  original_total numeric(19,4) not null default 0,
  discounts numeric(19,4) not null default 0,
  net_sales numeric(19,4) not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  shopify_gid text not null,
  legacy_resource_id text,
  note text,
  total_refunded numeric(19,4) not null default 0,
  currency text not null,
  created_at_shopify timestamptz,
  processed_at_shopify timestamptz not null,
  updated_at_shopify timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_refund_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  refund_id uuid not null references public.shopify_refunds(id) on delete cascade,
  order_line_id uuid references public.shopify_order_lines(id) on delete set null,
  shopify_gid text not null,
  line_item_gid text not null,
  quantity integer not null,
  subtotal numeric(19,4) not null default 0,
  currency text not null,
  restock_type text,
  synced_at timestamptz not null default now(),
  unique (store_id, shopify_gid)
);

create table if not exists public.shopify_order_attribution (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  attribution_model text not null check (attribution_model in ('first_touch', 'last_touch')),
  visit_gid text,
  occurred_at timestamptz,
  landing_page text,
  referrer_url text,
  source text,
  source_description text,
  source_type text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  days_to_conversion integer,
  customer_order_index integer,
  ready boolean not null default false,
  synced_at timestamptz not null default now(),
  unique (order_id, attribution_model)
);

create index if not exists sync_runs_store_idx on public.sync_runs(organization_id, store_id, created_at desc);
create index if not exists shopify_products_store_updated_idx on public.shopify_products(organization_id, store_id, updated_at_shopify);
create index if not exists shopify_variants_store_sku_idx on public.shopify_variants(organization_id, store_id, sku);
create index if not exists shopify_customers_store_updated_idx on public.shopify_customers(organization_id, store_id, updated_at_shopify);
create index if not exists shopify_orders_store_created_idx on public.shopify_orders(organization_id, store_id, created_at_shopify);
create index if not exists shopify_orders_customer_idx on public.shopify_orders(customer_id, created_at_shopify);
create index if not exists shopify_order_lines_order_idx on public.shopify_order_lines(order_id);
create index if not exists shopify_order_lines_variant_idx on public.shopify_order_lines(store_id, variant_gid);
create index if not exists shopify_refunds_order_idx on public.shopify_refunds(order_id, processed_at_shopify);
create index if not exists shopify_refund_lines_refund_idx on public.shopify_refund_lines(refund_id);
create index if not exists shopify_attribution_utm_idx on public.shopify_order_attribution(store_id, utm_source, utm_medium, utm_campaign);

alter table public.sync_runs enable row level security;
alter table public.shopify_products enable row level security;
alter table public.shopify_variants enable row level security;
alter table public.shopify_customers enable row level security;
alter table public.shopify_orders enable row level security;
alter table public.shopify_order_lines enable row level security;
alter table public.shopify_refunds enable row level security;
alter table public.shopify_refund_lines enable row level security;
alter table public.shopify_order_attribution enable row level security;

revoke all on public.sync_runs, public.shopify_products, public.shopify_variants,
  public.shopify_customers, public.shopify_orders, public.shopify_order_lines,
  public.shopify_refunds, public.shopify_refund_lines, public.shopify_order_attribution
from anon, authenticated;

grant select, insert, update on public.sync_runs to authenticated;
grant select, insert, update on public.shopify_products, public.shopify_variants,
  public.shopify_customers, public.shopify_orders, public.shopify_order_lines,
  public.shopify_refunds, public.shopify_refund_lines, public.shopify_order_attribution
to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sync_runs', 'shopify_products', 'shopify_variants', 'shopify_customers',
    'shopify_orders', 'shopify_order_lines', 'shopify_refunds',
    'shopify_refund_lines', 'shopify_order_attribution'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_member', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_org_member(organization_id)))',
      table_name || '_select_member', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_admin', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_org_member(organization_id, array[''owner'',''admin''])))',
      table_name || '_insert_admin', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_update_admin', table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_org_member(organization_id, array[''owner'',''admin'']))) with check ((select private.is_org_member(organization_id, array[''owner'',''admin''])))',
      table_name || '_update_admin', table_name
    );
  end loop;
end $$;
