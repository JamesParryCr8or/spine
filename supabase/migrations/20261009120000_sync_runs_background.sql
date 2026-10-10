-- Let the cron job run the Shopify catalogue/order import (TODO-AUDIT 1.1b).
--
-- created_by: a scheduled run has no user behind it. Manual runs still record
-- who started them; cron runs leave it null and set trigger = 'cron'.
--
-- 'paused': a cron run stops between order pages when its time budget runs
-- out, keeping its cursor. It is not an active status, so it doesn't hold
-- sync_runs_one_active_source_idx, and the next run (cron or manual)
-- resumes from the saved cursor.
alter table public.sync_runs alter column created_by drop not null;

alter table public.sync_runs
  add column if not exists trigger text not null default 'manual'
    check (trigger in ('manual', 'cron'));

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.sync_runs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
      and pg_get_constraintdef(oid) like '%cancelled%'
  loop
    execute format('alter table public.sync_runs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.sync_runs drop constraint if exists sync_runs_status_check;
alter table public.sync_runs
  add constraint sync_runs_status_check
    check (status in ('queued', 'running', 'paused', 'interrupted', 'completed', 'failed', 'cancelled'));
