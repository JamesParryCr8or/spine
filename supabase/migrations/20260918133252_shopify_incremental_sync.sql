alter table public.sync_runs
  add column if not exists sync_mode text not null default 'initial'
    check (sync_mode in ('initial', 'incremental')),
  add column if not exists window_start timestamptz,
  add column if not exists window_end timestamptz,
  add column if not exists pages_processed integer not null default 0
    check (pages_processed >= 0);

with ranked_active_runs as (
  select id, row_number() over (partition by store_id, source order by updated_at desc, created_at desc) as position
  from public.sync_runs
  where status in ('queued', 'running')
)
update public.sync_runs
set status = 'failed',
    error_message = coalesce(error_message, 'Superseded by a newer active sync checkpoint'),
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where id in (select id from ranked_active_runs where position > 1);

create unique index if not exists sync_runs_one_active_source_idx
  on public.sync_runs (store_id, source)
  where status in ('queued', 'running');

comment on column public.sync_runs.window_start is
  'Inclusive source updated-at boundary. Incremental Shopify runs overlap the previous completed run by seven days.';
comment on column public.sync_runs.window_end is
  'Exclusive source updated-at boundary fixed when the run starts so a resumed cursor sees the same result set.';
