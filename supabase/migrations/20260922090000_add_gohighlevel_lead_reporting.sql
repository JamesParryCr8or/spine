-- GoHighLevel lead-generation configuration and daily conversion totals.
alter table public.data_connections drop constraint if exists data_connections_provider_check;
alter table public.data_connections add constraint data_connections_provider_check
  check (provider in ('shopify', 'meta', 'google_ads', 'klaviyo', 'gohighlevel'));

alter table public.connection_secret_audit_events drop constraint if exists connection_secret_audit_events_provider_check;
alter table public.connection_secret_audit_events add constraint connection_secret_audit_events_provider_check
  check (provider in ('shopify', 'meta', 'google_ads', 'klaviyo', 'gohighlevel'));

create table if not exists public.gohighlevel_reporting_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null unique references public.stores(id) on delete cascade,
  source_type text not null check (source_type in ('contacts','opportunities')),
  selection_id text,
  selection_name text,
  metric_label text not null default 'Qualified leads',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gohighlevel_leads_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  metric_date date not null,
  source_type text not null check (source_type in ('contacts','opportunities')),
  selection_id text,
  metric_label text not null,
  lead_count integer not null default 0 check (lead_count >= 0),
  synced_at timestamptz not null default now(),
  primary key (store_id, metric_date, source_type, metric_label)
);

alter table public.gohighlevel_reporting_configs enable row level security;
alter table public.gohighlevel_leads_daily enable row level security;

create policy "GHL configurations are visible to workspace members" on public.gohighlevel_reporting_configs for select using (private.is_org_member(organization_id));
create policy "GHL configurations are managed by workspace admins" on public.gohighlevel_reporting_configs for all using (private.is_org_member(organization_id, array['owner','admin'])) with check (private.is_org_member(organization_id, array['owner','admin']));
create policy "GHL lead totals are visible to workspace members" on public.gohighlevel_leads_daily for select using (private.is_org_member(organization_id));
create policy "GHL lead totals are managed by workspace admins" on public.gohighlevel_leads_daily for all using (private.is_org_member(organization_id, array['owner','admin'])) with check (private.is_org_member(organization_id, array['owner','admin']));
