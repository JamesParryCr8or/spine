-- Run against a configured database. Everything is rolled back, including test charges.
begin;
select set_config('request.jwt.claim.sub', (
  select m.user_id::text from public.organization_members m
  join public.stores s on s.organization_id=m.organization_id
  join public.data_connections c on c.store_id=s.id and c.provider='shopify'
  where m.role in ('owner','admin') and c.external_account_id is not null limit 1
), true);
set local role authenticated;
do $$
declare
  target uuid; shop text; item jsonb; response jsonb; rejected boolean;
  identity text := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text)||':1';
begin
  select s.id,regexp_replace(c.external_account_id,'^.*/','') into target,shop
  from public.stores s join public.data_connections c on c.store_id=s.id and c.provider='shopify'
  where exists(select 1 from public.organization_members m where m.organization_id=s.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and c.external_account_id is not null limit 1;
  if target is null then raise exception 'No authorized connected store for test'; end if;
  item:=jsonb_build_object('charge_key',identity,'shop_id',shop,'bill_number',null,'bill_date',null,
    'charge_date','2026-10-01','category','application_fee','description','Rollback-only billing test',
    'amount','12.34','currency','GBP','original_amount','12.34','original_currency','GBP','raw',jsonb_build_object('App','Test'),'include_in_pnl',true);
  response:=public.import_shopify_billing(target,'test.csv',jsonb_build_array(item),'2026-10-01','2026-10-01');
  if response->>'added'<>'1' then raise exception 'First insert failed: %',response; end if;
  response:=public.import_shopify_billing(target,'test.csv',jsonb_build_array(item),'2026-10-01','2026-10-01');
  if response->>'skipped'<>'1' then raise exception 'Duplicate detection failed: %',response; end if;
  item:=item||jsonb_build_object('bill_number','12345','bill_date','2026-10-02','amount','12.35');
  response:=public.import_shopify_billing(target,'test.csv',jsonb_build_array(item),'2026-10-01','2026-10-01');
  if response->>'promoted'<>'1' then raise exception 'Promotion failed: %',response; end if;
  if not exists(select 1 from public.shopify_billing_charges where store_id=target and charge_key=identity and amount=12.35 and include_in_pnl) then raise exception 'Promotion data mismatch'; end if;
  response:=public.import_shopify_billing(target,'test.csv',jsonb_build_array(item||jsonb_build_object('bill_number',null)),'2026-10-01','2026-10-01');
  if response->>'skipped'<>'1' then raise exception 'Billed record was downgraded'; end if;
  if not exists(select 1 from public.shopify_billing_coverage where store_id=target and covered_from='2026-10-01' and covered_to='2026-10-01') then raise exception 'Coverage missing'; end if;
  rejected:=false;
  begin
    perform public.import_shopify_billing(target,'bad.csv',jsonb_build_array(item||jsonb_build_object('shop_id','not-the-shop')),'2026-10-01','2026-10-01');
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Wrong shop accepted'; end if;
  insert into public.shopify_billing_estimate_settings(store_id,enabled,overrides) values(target,false,'{}')
    on conflict(store_id) do update set enabled=false;
  if not exists(select 1 from public.shopify_billing_estimate_settings where store_id=target and not enabled) then raise exception 'Settings did not persist'; end if;
  perform set_config('test.billing_store',target::text,true);
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$
declare rejected boolean:=false;
begin
  if exists(select 1 from public.shopify_billing_charges) then raise exception 'Unrelated user could read charges'; end if;
  if exists(select 1 from public.shopify_billing_coverage) then raise exception 'Unrelated user could read coverage'; end if;
  if exists(select 1 from public.shopify_billing_estimate_settings) then raise exception 'Unrelated user could read settings'; end if;
  begin
    insert into public.shopify_billing_estimate_settings(store_id) values(current_setting('test.billing_store')::uuid);
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unrelated user could write settings'; end if;
  rejected:=false;
  begin
    perform public.import_shopify_billing(current_setting('test.billing_store')::uuid,'bad.csv','[]','2026-10-01','2026-10-01');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unrelated user could call importer'; end if;
end $$;
set local role anon;
do $$
declare rejected boolean:=false;
begin
  begin perform 1 from public.shopify_billing_charges; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Anonymous access was not denied'; end if;
end $$;
rollback;
select 'Billing import, promotion, coverage, settings and access checks passed; test writes rolled back' as result;
