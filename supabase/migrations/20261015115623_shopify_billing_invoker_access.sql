create or replace function public.import_shopify_billing(requested_store_id uuid, filename text, charges jsonb, export_from date, export_to date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  added integer := 0; promoted integer := 0; skipped integer := 0;
  connected_shop text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (exists (
    select 1 from public.store_memberships m where m.store_id=requested_store_id and m.user_id=auth.uid() and m.role='admin'
  ) or exists (
    select 1 from public.organization_members m join public.stores s on s.organization_id=m.organization_id
    where s.id=requested_store_id and m.user_id=auth.uid() and m.role in ('owner','admin')
  )) then raise exception 'Store admin access required' using errcode = '42501'; end if;
  if jsonb_typeof(charges) <> 'array' or jsonb_array_length(charges) not between 1 and 20000 then raise exception 'Invalid charge count'; end if;
  if export_from is null or export_to is null or export_to < export_from or export_to-export_from > 7305 then raise exception 'Invalid export date range'; end if;
  if exists(select 1 from jsonb_array_elements(charges) r where (r->>'charge_date')::date not between export_from and export_to) then raise exception 'All charges must fall within the export range'; end if;
  select regexp_replace(external_account_id, '^.*/', '') into connected_shop
  from public.data_connections where store_id = requested_store_id and provider = 'shopify';
  if connected_shop is null then raise exception 'Connect Shopify before importing bills'; end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_store_id::text, 42));
  if exists (select 1 from jsonb_array_elements(charges) r where r->>'shop_id' is distinct from connected_shop) then
    raise exception 'CSV shop does not match the connected store';
  end if;
  with written as (
    insert into public.shopify_billing_charges as current_charge
      (store_id,charge_key,shop_id,bill_number,bill_date,charge_date,category,description,
       amount,currency,original_amount,original_currency,raw,include_in_pnl,source_filename)
    select requested_store_id,r.charge_key,r.shop_id,r.bill_number,r.bill_date,r.charge_date,r.category,r.description,
      r.amount,r.currency,r.original_amount,r.original_currency,r.raw,coalesce(r.include_in_pnl,false),filename
    from jsonb_to_recordset(charges) as r(charge_key text,shop_id text,bill_number text,bill_date date,
      charge_date date,category text,description text,amount numeric,currency text,original_amount numeric,
      original_currency text,raw jsonb,include_in_pnl boolean)
    on conflict (store_id,charge_key) do update set bill_number=excluded.bill_number,bill_date=excluded.bill_date,
      amount=excluded.amount,currency=excluded.currency,raw=excluded.raw,source_filename=excluded.source_filename,updated_at=now()
    where current_charge.bill_number is null and excluded.bill_number is not null
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted),count(*) filter (where not inserted) into added,promoted from written;
  skipped := jsonb_array_length(charges) - added - promoted;
  insert into public.shopify_billing_coverage(store_id,covered_from,covered_to)
    values(requested_store_id,export_from,export_to) on conflict do nothing;
  return jsonb_build_object('added', added, 'promoted', promoted, 'skipped', skipped);
end $$;
revoke all on function public.import_shopify_billing(uuid,text,jsonb,date,date) from public, anon;
grant execute on function public.import_shopify_billing(uuid,text,jsonb,date,date) to authenticated;

