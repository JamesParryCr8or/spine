alter table public.saved_reports
  add column if not exists archived_at timestamptz;

create index if not exists saved_reports_active_organization_updated_idx
  on public.saved_reports (organization_id, updated_at desc)
  where archived_at is null;