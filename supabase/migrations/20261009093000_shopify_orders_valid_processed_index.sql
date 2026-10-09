-- Every analytics route (P&L, Products, UTM, Customers) runs the same
-- shape of query against shopify_orders: store_id = ?, cancelled_at is
-- null, test = false, processed_at within a range, ordered by
-- processed_at. No existing index matches it -
-- shopify_orders_store_created_idx is keyed on created_at_shopify, and
-- shopify_orders_store_country_processed_idx is keyed on processed_at but
-- not filtered to valid orders. Add a partial index scoped to exactly the
-- rows these routes read, with id as the second key so it also serves
-- keyset (seek) pagination on (processed_at, id).
create index if not exists shopify_orders_store_valid_processed_idx
  on public.shopify_orders (store_id, processed_at, id)
  where cancelled_at is null and test = false;
