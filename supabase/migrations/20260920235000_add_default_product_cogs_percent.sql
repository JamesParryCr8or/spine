-- Percentage fallback for products with no Shopify or manual COGS record.
alter table public.store_cost_defaults
  add column if not exists default_cogs_percent numeric(7,4) not null default 0
  check (default_cogs_percent >= 0 and default_cogs_percent <= 100);
