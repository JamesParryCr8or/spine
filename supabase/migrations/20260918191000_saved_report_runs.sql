-- Track saved-report executions against the exact definition version that ran.
alter table public.saved_reports
  add column if not exists last_successful_run_at timestamptz;

create table if not exists public.saved_report_runs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.saved_reports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  definition_version integer not null check (definition_version > 0),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  row_count integer check (row_count is null or row_count >= 0),
  error_message text check (error_message is null or length(error_message) <= 500),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade
);

create index if not exists saved_report_runs_org_started_idx
  on public.saved_report_runs (organization_id, started_at desc);
create index if not exists saved_report_runs_report_started_idx
  on public.saved_report_runs (report_id, started_at desc);
create index if not exists saved_report_runs_store_id_idx
  on public.saved_report_runs (store_id);
create index if not exists saved_report_runs_created_by_idx
  on public.saved_report_runs (created_by);

alter table public.saved_report_runs enable row level security;
revoke all on public.saved_report_runs from anon, authenticated;
grant select, insert, update on public.saved_report_runs to authenticated;

drop policy if exists "saved_report_runs_select_member" on public.saved_report_runs;
create policy "saved_report_runs_select_member"
on public.saved_report_runs for select to authenticated
using ((select private.is_org_member(organization_id)));

drop policy if exists "saved_report_runs_insert_member" on public.saved_report_runs;
create policy "saved_report_runs_insert_member"
on public.saved_report_runs for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.is_org_member(organization_id))
);

drop policy if exists "saved_report_runs_update_creator" on public.saved_report_runs;
create policy "saved_report_runs_update_creator"
on public.saved_report_runs for update to authenticated
using (
  created_by = (select auth.uid())
  and (select private.is_org_member(organization_id))
)
with check (
  created_by = (select auth.uid())
  and (select private.is_org_member(organization_id))
);
