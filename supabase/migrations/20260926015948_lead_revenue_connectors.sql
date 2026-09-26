-- Lead-gen receipts and costs. Immutable batch versions make rollback restore
-- the previous value, rather than accidentally deleting a later correction.
alter table public.data_connections drop constraint data_connections_provider_check;
alter table public.data_connections add constraint data_connections_provider_check check (provider in ('shopify','meta','google_ads','klaviyo','gohighlevel','stripe','google_sheets'));
alter table public.connection_secret_audit_events drop constraint connection_secret_audit_events_provider_check;
alter table public.connection_secret_audit_events add constraint connection_secret_audit_events_provider_check check (provider in ('shopify','meta','google_ads','klaviyo','gohighlevel','stripe','google_sheets'));
do $$ declare definition text; begin
  select pg_get_functiondef('public.save_data_connection(text,uuid,text,text,text)'::regprocedure) into definition;
  definition := replace(definition, '''gohighlevel'') then', '''gohighlevel'',''stripe'',''google_sheets'') then');
  if definition not like '%''stripe''%' then raise exception 'Unexpected save_data_connection definition'; end if;
  execute definition;
end $$;

create table public.revenue_connector_settings (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('stripe','google_sheets','csv')),
  settings jsonb not null default '{}',
  last_synced_at timestamptz,
  last_error text,
  primary key(store_id,provider)
);
create table public.revenue_import_batches (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  source text not null check (source in ('stripe','google_sheets','csv')),
  name text not null check (length(name) between 1 and 200),
  row_count integer not null check (row_count between 0 and 5000),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  unique(id,store_id)
);
create index revenue_batches_store on public.revenue_import_batches(store_id,sequence desc);
create table public.revenue_entry_versions (
  batch_id uuid not null references public.revenue_import_batches(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  entry_key text not null check (length(entry_key) between 1 and 250),
  external_id text not null check (length(external_id) between 1 and 120),
  entry_date date not null,
  kind text not null check (kind in ('sale','refund','cost')),
  label text not null check (length(label) between 1 and 80),
  amount_minor bigint not null check (amount_minor between 0 and 9000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opportunity_id text check (length(opportunity_id) <= 120),
  foreign key(batch_id,store_id) references public.revenue_import_batches(id,store_id) on delete cascade,
  primary key(batch_id,entry_key)
);
create index revenue_versions_store on public.revenue_entry_versions(store_id,entry_key);

alter table public.revenue_connector_settings enable row level security;
alter table public.revenue_import_batches enable row level security;
alter table public.revenue_entry_versions enable row level security;
do $$ declare t text; begin
  foreach t in array array['revenue_connector_settings','revenue_import_batches','revenue_entry_versions'] loop
    execute format('create policy member_read on public.%I for select to authenticated using (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id)))',t);
    execute format('create policy admin_write on public.%I for all to authenticated using (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array[''owner'',''admin'']))) with check (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array[''owner'',''admin''])))',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;
grant usage,select on sequence public.revenue_import_batches_sequence_seq to authenticated;

create view public.revenue_entries with (security_invoker=true) as
select distinct on (v.store_id,v.entry_key) v.*, b.source, b.sequence
from public.revenue_entry_versions v join public.revenue_import_batches b on b.id=v.batch_id and b.store_id=v.store_id
where b.rolled_back_at is null
order by v.store_id,v.entry_key,b.sequence desc;
grant select on public.revenue_entries to authenticated;
revoke all on public.revenue_entries from anon;

create function public.import_revenue_entries(requested_store_id uuid, source_name text, batch_name text, entries jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare batch uuid; begin
  if not exists(select 1 from public.stores s where s.id=requested_store_id and private.is_org_member(s.organization_id,array['owner','admin'])) then raise exception 'Owner or admin access required'; end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries)>5000 then raise exception 'Invalid import'; end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_store_id::text,0));
  insert into public.revenue_import_batches(store_id,source,name,row_count) values(requested_store_id,source_name,batch_name,jsonb_array_length(entries)) returning id into batch;
  insert into public.revenue_entry_versions(batch_id,store_id,entry_key,external_id,entry_date,kind,label,amount_minor,currency,opportunity_id)
  select batch,requested_store_id,e.entry_key,e.external_id,e.entry_date,e.kind,e.label,e.amount_minor,e.currency,e.opportunity_id
  from jsonb_to_recordset(entries) as e(entry_key text,external_id text,entry_date date,kind text,label text,amount_minor bigint,currency text,opportunity_id text);
  return batch;
end $$;
revoke all on function public.import_revenue_entries(uuid,text,text,jsonb) from public,anon;
grant execute on function public.import_revenue_entries(uuid,text,text,jsonb) to authenticated;
