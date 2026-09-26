-- Connections managers may sync Stripe receipts, but cannot import CSV or Sheets rows.
create policy connector_stripe_batch_insert on public.revenue_import_batches
for insert to authenticated with check (
  source = 'stripe' and exists (
    select 1 from public.stores s where s.id = store_id
      and private.is_org_member(s.organization_id, array['connector'])
  )
);

create policy connector_stripe_entry_insert on public.revenue_entry_versions
for insert to authenticated with check (
  exists (
    select 1 from public.revenue_import_batches b
    join public.stores s on s.id = b.store_id
    where b.id = revenue_entry_versions.batch_id and b.store_id = revenue_entry_versions.store_id and b.source = 'stripe'
      and private.is_org_member(s.organization_id, array['connector'])
  )
);

create or replace function public.import_revenue_entries(requested_store_id uuid, source_name text, batch_name text, entries jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare batch uuid; begin
  if not exists (
    select 1 from public.stores s
    join public.organization_members m on m.organization_id = s.organization_id
    where s.id = requested_store_id and m.user_id = (select auth.uid())
      and (m.role in ('owner','admin') or (m.role = 'connector' and source_name = 'stripe'))
  ) then raise exception 'Import access required'; end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 5000 then raise exception 'Invalid import'; end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_store_id::text,0));
  insert into public.revenue_import_batches(store_id,source,name,row_count)
    values(requested_store_id,source_name,batch_name,jsonb_array_length(entries)) returning id into batch;
  insert into public.revenue_entry_versions(batch_id,store_id,entry_key,external_id,entry_date,kind,label,amount_minor,currency,opportunity_id)
  select batch,requested_store_id,e.entry_key,e.external_id,e.entry_date,e.kind,e.label,e.amount_minor,e.currency,e.opportunity_id
  from jsonb_to_recordset(entries) as e(entry_key text,external_id text,entry_date date,kind text,label text,amount_minor bigint,currency text,opportunity_id text);
  return batch;
end $$;
revoke all on function public.import_revenue_entries(uuid,text,text,jsonb) from public,anon;
grant execute on function public.import_revenue_entries(uuid,text,text,jsonb) to authenticated;
