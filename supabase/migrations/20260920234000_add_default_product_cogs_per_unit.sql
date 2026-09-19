-- Optional product COGS fallback for products with no Shopify or manual unit cost.
alter table public.store_cost_defaults
  add column if not exists default_cogs_per_unit numeric(19,4) not null default 0
  check (default_cogs_per_unit >= 0);
