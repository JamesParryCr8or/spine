-- Per-store daily refresh time, and a 'login' trigger for the refresh that
-- starts when someone opens the app.
--
-- sync_hour is 0-23 in the store's own timezone. No row means the default
-- (enabled, 06:00), so existing stores keep refreshing without setup.
create table public.store_sync_schedule (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  sync_hour smallint not null default 6 check (sync_hour between 0 and 23),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.store_sync_schedule enable row level security;
grant select, insert, update on public.store_sync_schedule to authenticated;

create policy store_sync_schedule_read on public.store_sync_schedule
  for select to authenticated
  using (private.has_store_membership(store_id) or private.is_org_member(organization_id));
create policy store_sync_schedule_insert on public.store_sync_schedule
  for insert to authenticated
  with check (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));
create policy store_sync_schedule_update on public.store_sync_schedule
  for update to authenticated
  using (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']))
  with check (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));

alter table public.reporting_sync_runs drop constraint if exists reporting_sync_runs_trigger_check;
alter table public.reporting_sync_runs
  add constraint reporting_sync_runs_trigger_check check (trigger in ('cron', 'manual', 'login'));

alter table public.sync_runs drop constraint if exists sync_runs_trigger_check;
alter table public.sync_runs
  add constraint sync_runs_trigger_check check (trigger in ('manual', 'cron', 'login'));
