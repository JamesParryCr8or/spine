-- Effective-dated exchange rates for explicit source-to-reporting currency conversion.
create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(24,10) not null check (rate > 0),
  effective_date date not null,
  source text not null default 'manual' check (source in ('manual', 'shopify', 'imported')),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (base_currency <> quote_currency),
  unique (store_id, base_currency, quote_currency, effective_date)
);

create index if not exists exchange_rates_org_store_date_idx
  on public.exchange_rates (organization_id, store_id, effective_date desc);
create index if not exists exchange_rates_store_pair_date_idx
  on public.exchange_rates (store_id, base_currency, quote_currency, effective_date desc);
create index if not exists exchange_rates_created_by_idx
  on public.exchange_rates (created_by);

alter table public.exchange_rates enable row level security;
revoke all on public.exchange_rates from anon, authenticated;
grant select, insert, update, delete on public.exchange_rates to authenticated;

drop policy if exists "exchange_rates_select_member" on public.exchange_rates;
create policy "exchange_rates_select_member"
on public.exchange_rates for select to authenticated
using ((select private.is_org_member(organization_id)));

drop policy if exists "exchange_rates_insert_admin" on public.exchange_rates;
create policy "exchange_rates_insert_admin"
on public.exchange_rates for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.is_org_member(organization_id, array['owner','admin']))
);

drop policy if exists "exchange_rates_update_admin" on public.exchange_rates;
create policy "exchange_rates_update_admin"
on public.exchange_rates for update to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])))
with check ((select private.is_org_member(organization_id, array['owner','admin'])));

drop policy if exists "exchange_rates_delete_admin" on public.exchange_rates;
create policy "exchange_rates_delete_admin"
on public.exchange_rates for delete to authenticated
using ((select private.is_org_member(organization_id, array['owner','admin'])));
