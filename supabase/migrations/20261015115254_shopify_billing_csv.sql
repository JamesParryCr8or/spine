create table public.shopify_billing_charges (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  charge_key text not null check (length(charge_key) between 66 and 75),
  shop_id text not null check (shop_id ~ '^[0-9]+$'),
  bill_number text,
  bill_date date,
  charge_date date not null,
  category text not null,
  description text not null,
  amount numeric(24,8) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  original_amount numeric(24,8),
  original_currency text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  include_in_pnl boolean not null default false,
  source_filename text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, charge_key),
  check ((original_amount is null) = (original_currency is null))
);
create index shopify_billing_charges_creator_idx on public.shopify_billing_charges(created_by);
alter table public.shopify_billing_charges enable row level security;
revoke all on public.shopify_billing_charges from anon, authenticated;
grant select, insert, update, delete on public.shopify_billing_charges to authenticated;
grant all on public.shopify_billing_charges to service_role;
create policy billing_read on public.shopify_billing_charges for select to authenticated
using (private.has_store_membership(store_id) or exists (
  select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id)
));
create policy billing_write on public.shopify_billing_charges for all to authenticated
using (private.has_store_membership(store_id, array['admin']) or exists (
  select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id, array['owner','admin'])
))
with check (private.has_store_membership(store_id, array['admin']) or exists (
  select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id, array['owner','admin'])
));

create table public.shopify_billing_coverage (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  covered_from date not null, covered_to date not null,
  check (covered_to >= covered_from), unique(store_id,covered_from,covered_to)
);
create table public.shopify_billing_estimate_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  enabled boolean not null default true,
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides)='object')
);

alter table public.shopify_billing_coverage enable row level security;
revoke all on public.shopify_billing_coverage from anon,authenticated;
grant select,insert,update,delete on public.shopify_billing_coverage to authenticated;
grant all on public.shopify_billing_coverage to service_role;
create policy billing_read on public.shopify_billing_coverage for select to authenticated using (
 private.has_store_membership(store_id) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id))
);
create policy billing_write on public.shopify_billing_coverage for all to authenticated using (
 private.has_store_membership(store_id,array['admin']) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array['owner','admin']))
) with check (
 private.has_store_membership(store_id,array['admin']) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array['owner','admin']))
);

alter table public.shopify_billing_estimate_settings enable row level security;
revoke all on public.shopify_billing_estimate_settings from anon,authenticated;
grant select,insert,update,delete on public.shopify_billing_estimate_settings to authenticated;
grant all on public.shopify_billing_estimate_settings to service_role;
create policy billing_read on public.shopify_billing_estimate_settings for select to authenticated using (
 private.has_store_membership(store_id) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id))
);
create policy billing_write on public.shopify_billing_estimate_settings for all to authenticated using (
 private.has_store_membership(store_id,array['admin']) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array['owner','admin']))
) with check (
 private.has_store_membership(store_id,array['admin']) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array['owner','admin']))
);

-- One transaction per file; concurrent/repeated imports cannot duplicate charges.
create function public.import_shopify_billing(requested_store_id uuid, filename text, charges jsonb, export_from date, export_to date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  added integer := 0; promoted integer := 0; skipped integer := 0;
  connected_shop text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (private.has_store_membership(requested_store_id, array['admin']) or exists (
    select 1 from public.stores s where s.id = requested_store_id and private.is_org_member(s.organization_id, array['owner','admin'])
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

