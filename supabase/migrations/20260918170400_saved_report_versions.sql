-- Version saved report definitions and retain an immutable tenant-visible revision history.
alter table public.saved_reports
  add column if not exists definition_version integer not null default 1
  check (definition_version > 0);

create table if not exists public.saved_report_revisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.saved_reports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  definition_version integer not null check (definition_version > 0),
  definition jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (report_id, definition_version)
);

create index if not exists saved_report_revisions_org_report_idx
  on public.saved_report_revisions (organization_id, report_id, definition_version desc);

alter table public.saved_report_revisions enable row level security;
revoke all on public.saved_report_revisions from anon, authenticated;
grant select on public.saved_report_revisions to authenticated;

drop policy if exists "saved_report_revisions_select_member" on public.saved_report_revisions;
create policy "saved_report_revisions_select_member"
on public.saved_report_revisions for select to authenticated
using ((select private.is_org_member(organization_id)));

create or replace function private.bump_saved_report_definition_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    new.store_id, new.report_type, new.name, new.description, new.configuration,
    new.visibility, new.is_favorite, new.archived_at
  ) is distinct from row(
    old.store_id, old.report_type, old.name, old.description, old.configuration,
    old.visibility, old.is_favorite, old.archived_at
  ) then
    new.definition_version := old.definition_version + 1;
  else
    new.definition_version := old.definition_version;
  end if;
  return new;
end;
$$;

revoke all on function private.bump_saved_report_definition_version() from public, anon, authenticated;

drop trigger if exists saved_reports_bump_definition_version on public.saved_reports;
create trigger saved_reports_bump_definition_version
before update on public.saved_reports
for each row execute function private.bump_saved_report_definition_version();

create or replace function private.capture_saved_report_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.definition_version is distinct from old.definition_version then
    insert into public.saved_report_revisions (
      report_id, organization_id, store_id, definition_version, definition, changed_by
    ) values (
      new.id,
      new.organization_id,
      new.store_id,
      new.definition_version,
      jsonb_build_object(
        'schemaVersion', coalesce((new.configuration ->> 'schemaVersion')::integer, 1),
        'reportType', new.report_type,
        'name', new.name,
        'description', new.description,
        'configuration', new.configuration,
        'visibility', new.visibility,
        'isFavorite', new.is_favorite,
        'archivedAt', new.archived_at
      ),
      (select auth.uid())
    )
    on conflict (report_id, definition_version) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_saved_report_revision() from public, anon, authenticated;

drop trigger if exists saved_reports_capture_revision on public.saved_reports;
create trigger saved_reports_capture_revision
after insert or update on public.saved_reports
for each row execute function private.capture_saved_report_revision();

insert into public.saved_report_revisions (
  report_id, organization_id, store_id, definition_version, definition, changed_by, changed_at
)
select
  report.id,
  report.organization_id,
  report.store_id,
  report.definition_version,
  jsonb_build_object(
    'schemaVersion', coalesce((report.configuration ->> 'schemaVersion')::integer, 1),
    'reportType', report.report_type,
    'name', report.name,
    'description', report.description,
    'configuration', report.configuration,
    'visibility', report.visibility,
    'isFavorite', report.is_favorite,
    'archivedAt', report.archived_at
  ),
  report.created_by,
  report.updated_at
from public.saved_reports report
on conflict (report_id, definition_version) do nothing;
