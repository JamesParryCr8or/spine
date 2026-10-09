-- Store-scoped member isolation (TODO-AUDIT 8.3).
-- Run against a disposable or development Supabase database, after every
-- migration. Every fixture is contained in this transaction and rolled back.
--
-- A member invited to one store of an organization must not read a sibling
-- store's rows in the tables the /api/analytics/* and /api/costs/* routes
-- read, and a store "viewer" must not read order-level data even in their
-- own store.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scope-owner@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"company_name":"Scope owner"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scope-member@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"company_name":"Scope member"}'::jsonb, now(), now()
  );

select set_config(
  'test.org_id',
  (select id::text from public.organizations where created_by = '00000000-0000-4000-8000-0000000000c1'),
  true
);
with granted as (
  insert into public.stores (organization_id, name)
  values (current_setting('test.org_id')::uuid, 'Scope granted store')
  returning id
)
select set_config('test.granted_store_id', (select id::text from granted), true);
with sibling as (
  insert into public.stores (organization_id, name)
  values (current_setting('test.org_id')::uuid, 'Scope sibling store')
  returning id
)
select set_config('test.sibling_store_id', (select id::text from sibling), true);

-- The same rows in both stores.
do $$
declare
  org uuid := current_setting('test.org_id')::uuid;
  owner_id uuid := '00000000-0000-4000-8000-0000000000c1';
  target uuid;
begin
  foreach target in array array[current_setting('test.granted_store_id')::uuid, current_setting('test.sibling_store_id')::uuid] loop
    insert into public.shopify_orders (organization_id, store_id, shopify_gid, order_name, created_at_shopify, updated_at_shopify, currency, presentment_currency, processed_at)
    values (org, target, 'gid://shopify/Order/' || target, '#1001', now(), now(), 'GBP', 'GBP', now());
    insert into public.shopify_sales_daily (organization_id, store_id, sales_date, currency)
    values (org, target, current_date, 'GBP');
    insert into public.custom_costs (organization_id, store_id, name, category, amount, currency, cadence, effective_from, created_by)
    values (org, target, 'Software', 'software', 10, 'GBP', 'monthly', current_date, owner_id);
    insert into public.product_costs (organization_id, store_id, cost_key, source, sku, amount, currency, effective_from, created_by)
    values (org, target, 'sku:scope-test', 'manual', 'SCOPE-TEST', 5, 'GBP', current_date, owner_id);
    insert into public.payment_fee_rules (organization_id, store_id, gateway, currency, effective_from, created_by)
    values (org, target, 'paypal', 'GBP', current_date, owner_id);
  end loop;
end
$$;

insert into public.store_memberships (store_id, user_id, email, role)
values (
  current_setting('test.granted_store_id')::uuid,
  '00000000-0000-4000-8000-0000000000c2',
  'scope-member@example.invalid',
  'analyst'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c2', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  table_name text;
  visible integer;
begin
  foreach table_name in array array['shopify_orders', 'shopify_sales_daily', 'custom_costs', 'product_costs', 'payment_fee_rules'] loop
    execute format('select count(*) from public.%I where store_id = $1', table_name)
      into visible using current_setting('test.granted_store_id')::uuid;
    if visible < 1 then
      raise exception 'Store analyst cannot read % in their own store', table_name;
    end if;

    execute format('select count(*) from public.%I where store_id = $1', table_name)
      into visible using current_setting('test.sibling_store_id')::uuid;
    if visible <> 0 then
      raise exception 'Store analyst can read % in a sibling store', table_name;
    end if;
  end loop;

  if exists (select 1 from public.stores where id = current_setting('test.sibling_store_id')::uuid) then
    raise exception 'Store analyst can see a sibling store';
  end if;
end
$$;

-- Viewers get summaries, not order-level data, even in their own store.
reset role;
update public.store_memberships
set role = 'viewer'
where store_id = current_setting('test.granted_store_id')::uuid
  and user_id = '00000000-0000-4000-8000-0000000000c2';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c2', true);

do $$
begin
  if exists (select 1 from public.shopify_orders where store_id = current_setting('test.granted_store_id')::uuid) then
    raise exception 'Store viewer can read order-level data';
  end if;
  if not exists (select 1 from public.shopify_sales_daily where store_id = current_setting('test.granted_store_id')::uuid) then
    raise exception 'Store viewer cannot read daily summaries in their own store';
  end if;
end
$$;

reset role;
rollback;
