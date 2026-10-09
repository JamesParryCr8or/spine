-- One in-flight heavy job per store and job name (TODO-AUDIT 8.4).
--
-- Serverless instances share no memory, so the lock lives here. A lock
-- expires on its own after ttl_seconds (the route's maxDuration), so a
-- function that dies mid-job never blocks the store for long.
create table if not exists private.store_job_locks (
  store_id uuid not null references public.stores(id) on delete cascade,
  job text not null,
  locked_until timestamptz not null,
  primary key (store_id, job)
);

-- Returns 0 when the lock was taken, otherwise the seconds until the
-- current holder's lock expires (for Retry-After).
create or replace function public.try_acquire_job_lock(requested_store_id uuid, job_name text, ttl_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  if not (
    private.has_store_membership(requested_store_id)
    or exists (select 1 from public.stores store where store.id = requested_store_id and private.is_org_member(store.organization_id))
  ) then
    raise exception 'Store access is required' using errcode = '42501';
  end if;

  insert into private.store_job_locks (store_id, job, locked_until)
  values (requested_store_id, job_name, now() + make_interval(secs => least(greatest(ttl_seconds, 1), 900)))
  on conflict (store_id, job) do update
    set locked_until = excluded.locked_until
    where private.store_job_locks.locked_until <= now();
  if found then
    return 0;
  end if;

  select greatest(1, ceil(extract(epoch from locked_until - now()))::integer)
  into remaining
  from private.store_job_locks
  where store_id = requested_store_id and job = job_name;
  return coalesce(remaining, 1);
end
$$;

create or replace function public.release_job_lock(requested_store_id uuid, job_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_store_membership(requested_store_id)
    or exists (select 1 from public.stores store where store.id = requested_store_id and private.is_org_member(store.organization_id))
  ) then
    raise exception 'Store access is required' using errcode = '42501';
  end if;
  delete from private.store_job_locks where store_id = requested_store_id and job = job_name;
end
$$;

revoke all on function public.try_acquire_job_lock(uuid, text, integer) from public, anon;
revoke all on function public.release_job_lock(uuid, text) from public, anon;
grant execute on function public.try_acquire_job_lock(uuid, text, integer) to authenticated;
grant execute on function public.release_job_lock(uuid, text) to authenticated;
