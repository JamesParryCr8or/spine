create index revenue_versions_batch_store on public.revenue_entry_versions(batch_id,store_id);
do $$ declare t text; begin
  foreach t in array array['revenue_connector_settings','revenue_import_batches','revenue_entry_versions'] loop
    execute format('drop policy admin_write on public.%I',t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array[''owner'',''admin''])))',t);
    execute format('create policy admin_update on public.%I for update to authenticated using (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array[''owner'',''admin'']))) with check (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array[''owner'',''admin''])))',t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using (exists (select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array[''owner'',''admin''])))',t);
  end loop;
end $$;
