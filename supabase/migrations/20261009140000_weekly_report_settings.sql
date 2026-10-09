-- Per-store, opt-in destination for the weekly report (TODO-AUDIT 8.2).
--
-- Before this, one global GHL_WEEKLY_REPORT_WEBHOOK_URL received every store
-- in every organization. Now a store gets the report only when an owner or
-- admin turns it on. webhook_url is optional: when null, the global
-- variable is used, but still only for stores that opted in.
--
-- A webhook URL works as a write credential for whoever owns the endpoint,
-- so only owners/admins can read it.
create table public.weekly_report_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  webhook_url text check (webhook_url is null or webhook_url ~ '^https://'),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.weekly_report_settings enable row level security;
grant select, insert, update on public.weekly_report_settings to authenticated;

create policy weekly_report_settings_read on public.weekly_report_settings
  for select to authenticated
  using (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));
create policy weekly_report_settings_insert on public.weekly_report_settings
  for insert to authenticated
  with check (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));
create policy weekly_report_settings_update on public.weekly_report_settings
  for update to authenticated
  using (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']))
  with check (private.has_store_membership(store_id, array['admin']) or private.is_org_member(organization_id, array['owner','admin']));
