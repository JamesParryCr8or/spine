-- Tracks the lightweight, read-model reporting refresh (ShopifyQL daily
-- sales/fees, Meta, Google Ads, Microsoft Ads) run by the scheduled cron
-- job and the manual "Sync now" action, separately from the heavyweight
-- Shopify catalogue/order sync tracked in sync_runs. That table requires a
-- real auth.users row via created_by, which a cron-triggered run has none
-- of, and ties its unique active-run lock to a source value ('shopify')
-- already used by the catalogue/order importer.

create table public.reporting_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  window_start date not null,
  window_end date not null,
  results jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index reporting_sync_runs_store_idx
  on public.reporting_sync_runs (organization_id, store_id, created_at desc);

-- One in-flight reporting refresh per store. refreshReportingData() already
-- fans out to every source in parallel, so the lock is per store, not per
-- (store, source).
create unique index reporting_sync_runs_one_active_idx
  on public.reporting_sync_runs (store_id)
  where status = 'running';

alter table public.reporting_sync_runs enable row level security;
revoke all on public.reporting_sync_runs from anon, authenticated;
grant select on public.reporting_sync_runs to authenticated;

create policy reporting_sync_runs_read on public.reporting_sync_runs
  for select to authenticated using (
    private.has_store_membership(store_id) or private.is_org_member(organization_id, array['owner','admin'])
  );

-- Only the server (service role) writes rows; authenticated clients only read.
