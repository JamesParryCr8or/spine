-- Cover every foreign key currently reported by the Supabase performance advisor.
create index if not exists product_cost_audit_events_changed_by_idx
  on public.product_cost_audit_events (changed_by);
create index if not exists product_cost_audit_events_store_id_idx
  on public.product_cost_audit_events (store_id);
create index if not exists saved_report_revisions_changed_by_idx
  on public.saved_report_revisions (changed_by);
create index if not exists saved_report_revisions_store_id_idx
  on public.saved_report_revisions (store_id);
create index if not exists shopify_transactions_organization_id_idx
  on public.shopify_transactions (organization_id);
