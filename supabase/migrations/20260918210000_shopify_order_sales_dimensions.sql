alter table public.shopify_orders
  add column if not exists country_code text,
  add column if not exists discount_codes text[] not null default '{}';

alter table public.shopify_orders
  drop constraint if exists shopify_orders_country_code_format;
alter table public.shopify_orders
  add constraint shopify_orders_country_code_format
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

create index if not exists shopify_orders_store_country_processed_idx
  on public.shopify_orders (store_id, country_code, processed_at desc);
create index if not exists shopify_orders_discount_codes_idx
  on public.shopify_orders using gin (discount_codes);
