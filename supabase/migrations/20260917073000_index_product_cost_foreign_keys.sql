create index if not exists product_costs_import_batch_idx
  on public.product_costs(import_batch_id);
create index if not exists product_costs_created_by_idx
  on public.product_costs(created_by);
create index if not exists product_cost_batches_store_id_idx
  on public.product_cost_import_batches(store_id);
create index if not exists product_cost_batches_created_by_idx
  on public.product_cost_import_batches(created_by);
