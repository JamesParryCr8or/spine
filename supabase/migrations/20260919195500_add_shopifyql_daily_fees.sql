alter table public.shopify_sales_daily
  add column if not exists shopify_payments_processing_fees numeric(18,2) not null default 0,
  add column if not exists foreign_exchange_fees numeric(18,2) not null default 0,
  add column if not exists managed_markets_fees numeric(18,2) not null default 0,
  add column if not exists international_fees numeric(18,2) not null default 0,
  add column if not exists total_payment_fees numeric(18,2) not null default 0;
