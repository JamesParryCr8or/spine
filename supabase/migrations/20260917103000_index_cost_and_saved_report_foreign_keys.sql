-- Cover foreign keys used by operating-cost and saved-report queries.
create index if not exists custom_costs_store_id_idx on public.custom_costs(store_id);
create index if not exists custom_costs_created_by_idx on public.custom_costs(created_by);
create index if not exists saved_reports_store_id_idx on public.saved_reports(store_id);
create index if not exists saved_reports_created_by_idx on public.saved_reports(created_by);
