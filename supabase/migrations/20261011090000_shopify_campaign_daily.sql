-- Daily campaign attribution from ShopifyQL's campaign_sales dataset: one row
-- per day x utm source/medium/campaign x new-or-returning, carrying the
-- first-click, last-click and last-non-direct measures. This replaces reading
-- every order's attribution row for the UTM screen, so storage grows with
-- campaigns x days instead of orders.

create table if not exists public.shopify_campaign_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sales_date date not null,
  -- Lower-cased and trimmed; '' means the order carried no value (direct / untagged).
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  customer_type text not null default 'unknown' check (customer_type in ('new', 'returning', 'unknown')),
  last_click_orders integer not null default 0 check (last_click_orders >= 0),
  last_click_sales numeric(18,2) not null default 0,
  last_non_direct_orders integer not null default 0 check (last_non_direct_orders >= 0),
  last_non_direct_sales numeric(18,2) not null default 0,
  first_click_orders integer not null default 0 check (first_click_orders >= 0),
  first_click_sales numeric(18,2) not null default 0,
  currency text not null,
  synced_at timestamptz not null default now(),
  primary key (store_id, sales_date, utm_source, utm_medium, utm_campaign, customer_type)
);

create index if not exists shopify_campaign_daily_org_store_date_idx
  on public.shopify_campaign_daily (organization_id, store_id, sales_date desc);

alter table public.shopify_campaign_daily enable row level security;
revoke all on public.shopify_campaign_daily from anon, authenticated;
grant select on public.shopify_campaign_daily to authenticated;

-- Written only by the server (service role); members can read their own stores.
create policy shopify_campaign_daily_select_member
on public.shopify_campaign_daily for select to authenticated
using ((select private.is_org_member(organization_id)));

-- Remembers how far back campaign data has been fetched, so a store with no
-- campaigns at all is not re-backfilled on every sync.
create table if not exists public.shopify_campaign_sync_state (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  backfilled_from date not null,
  synced_at timestamptz not null default now()
);

alter table public.shopify_campaign_sync_state enable row level security;
revoke all on public.shopify_campaign_sync_state from anon, authenticated;
grant select on public.shopify_campaign_sync_state to authenticated;

create policy shopify_campaign_sync_state_select_member
on public.shopify_campaign_sync_state for select to authenticated
using ((select private.is_org_member(organization_id)));
