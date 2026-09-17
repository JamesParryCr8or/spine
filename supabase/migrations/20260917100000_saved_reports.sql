-- Saved report definitions for reusable analytics views.
create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  report_type text not null check (report_type in ('overview', 'pnl', 'sales', 'products', 'customers', 'utm')),
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  configuration jsonb not null default '{}'::jsonb,
  visibility text not null default 'private' check (visibility in ('private', 'organization')),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_reports_org_type_idx on public.saved_reports(organization_id, report_type, updated_at desc);
alter table public.saved_reports enable row level security;
revoke all on public.saved_reports from anon, authenticated;
grant select, insert, update, delete on public.saved_reports to authenticated;

drop policy if exists "saved_reports_select_member" on public.saved_reports;
create policy "saved_reports_select_member" on public.saved_reports for select to authenticated
using ((select private.is_org_member(organization_id)) and (visibility = 'organization' or created_by = (select auth.uid()) or (select private.is_org_member(organization_id, array['owner','admin']))));

drop policy if exists "saved_reports_insert_member" on public.saved_reports;
create policy "saved_reports_insert_member" on public.saved_reports for insert to authenticated
with check (created_by = (select auth.uid()) and (select private.is_org_member(organization_id)));

drop policy if exists "saved_reports_update_owner" on public.saved_reports;
create policy "saved_reports_update_owner" on public.saved_reports for update to authenticated
using (created_by = (select auth.uid()) or (select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id)));

drop policy if exists "saved_reports_delete_owner" on public.saved_reports;
create policy "saved_reports_delete_owner" on public.saved_reports for delete to authenticated
using (created_by = (select auth.uid()) or (select private.is_org_member(organization_id, array['owner','admin'])));