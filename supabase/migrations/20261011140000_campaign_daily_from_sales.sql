-- The campaign table now comes from ShopifyQL's sales dataset (order_utm_*
-- dimensions) instead of campaign_sales: it covers every order, so untagged
-- sales are visible too, and it reports net sales. The table held no rows
-- (campaign_sales returned nothing for the connected store), so the
-- attribution-model columns are replaced and the backfill marker is cleared
-- so the next sync fetches two years with the new query.

delete from public.shopify_campaign_daily;
delete from public.shopify_campaign_sync_state;

alter table public.shopify_campaign_daily
  drop column if exists last_click_orders,
  drop column if exists last_click_sales,
  drop column if exists last_non_direct_orders,
  drop column if exists last_non_direct_sales,
  drop column if exists first_click_orders,
  drop column if exists first_click_sales,
  add column if not exists orders integer not null default 0 check (orders >= 0),
  add column if not exists net_sales numeric(18,2) not null default 0;
