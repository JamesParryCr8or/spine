create table if not exists public.custom_spend_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  original_filename text not null,
  row_count integer not null check (row_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists custom_spend_batches_org_created_idx on public.custom_spend_import_batches (organization_id, created_at desc);
create index if not exists custom_spend_batches_store_id_idx on public.custom_spend_import_batches (store_id);
create index if not exists custom_spend_batches_created_by_idx on public.custom_spend_import_batches (created_by);

create table if not exists public.custom_spend_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  import_batch_id uuid references public.custom_spend_import_batches(id) on delete set null,
  spend_date date not null,
  source text not null,
  medium text not null,
  campaign text not null,
  account text,
  ad_group text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  spend numeric(19,4) not null check (spend >= 0),
  external_id text,
  deterministic_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, deterministic_key)
);
create index if not exists custom_spend_store_date_idx on public.custom_spend_daily (store_id, spend_date);
create index if not exists custom_spend_store_target_idx on public.custom_spend_daily (store_id, source, medium, campaign, spend_date);
create index if not exists custom_spend_org_id_idx on public.custom_spend_daily (organization_id);
create index if not exists custom_spend_batch_id_idx on public.custom_spend_daily (import_batch_id);
create index if not exists custom_spend_created_by_idx on public.custom_spend_daily (created_by);

alter table public.custom_spend_import_batches enable row level security;
alter table public.custom_spend_daily enable row level security;
revoke all on public.custom_spend_import_batches from anon, authenticated;
revoke all on public.custom_spend_daily from anon, authenticated;
grant select, insert, update, delete on public.custom_spend_import_batches to authenticated;
grant select, insert, update, delete on public.custom_spend_daily to authenticated;

create policy custom_spend_batches_select_member on public.custom_spend_import_batches for select to authenticated
using (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_import_batches.organization_id and membership.user_id = (select auth.uid())));
create policy custom_spend_batches_insert_admin on public.custom_spend_import_batches for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_import_batches.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')));
create policy custom_spend_batches_update_admin on public.custom_spend_import_batches for update to authenticated
using (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_import_batches.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')))
with check (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_import_batches.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')));
create policy custom_spend_batches_delete_admin on public.custom_spend_import_batches for delete to authenticated
using (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_import_batches.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')));

create policy custom_spend_select_member on public.custom_spend_daily for select to authenticated
using (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_daily.organization_id and membership.user_id = (select auth.uid())));
create policy custom_spend_insert_admin on public.custom_spend_daily for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_daily.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')));
create policy custom_spend_update_admin on public.custom_spend_daily for update to authenticated
using (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_daily.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')))
with check (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_daily.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')));
create policy custom_spend_delete_admin on public.custom_spend_daily for delete to authenticated
using (exists (select 1 from public.organization_members membership where membership.organization_id = custom_spend_daily.organization_id and membership.user_id = (select auth.uid()) and membership.role in ('owner','admin')));
