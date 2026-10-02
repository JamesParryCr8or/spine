-- Store invitations are separate from organization_members so they cannot grant
-- access to every store in an organization.
alter table public.organization_invitations
  add column store_id uuid references public.stores(id) on delete cascade;

-- Existing invitations were workspace-wide. Revoke unaccepted links so an old
-- link cannot retain broader access after the store-scoped model is introduced.
update public.organization_invitations
set revoked_at = now()
where accepted_at is null and revoked_at is null;

drop index if exists public.organization_invitations_pending_email_idx;
create unique index organization_invitations_pending_store_email_idx
  on public.organization_invitations(store_id, email)
  where store_id is not null and accepted_at is null and revoked_at is null;

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null references public.organization_roles(key) check (role <> 'owner'),
  created_at timestamptz not null default now(),
  unique (store_id, user_id),
  check (email = lower(email) and length(email) <= 254)
);
create index store_memberships_user_idx on public.store_memberships(user_id, store_id);
alter table public.store_memberships enable row level security;
revoke all on public.store_memberships from anon, authenticated;
grant select on public.store_memberships to authenticated;

create or replace function private.has_store_membership(target_store_id uuid, allowed_roles text[] default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.store_memberships membership
    where membership.store_id = target_store_id
      and membership.user_id = (select auth.uid())
      and (allowed_roles is null or membership.role = any(allowed_roles))
  );
$$;
revoke all on function private.has_store_membership(uuid, text[]) from public;
grant execute on function private.has_store_membership(uuid, text[]) to authenticated;

create or replace function private.has_store_membership_in_organization(target_organization_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.store_memberships membership
    join public.stores store on store.id = membership.store_id
    where store.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;
revoke all on function private.has_store_membership_in_organization(uuid) from public;
grant execute on function private.has_store_membership_in_organization(uuid) to authenticated;

create policy store_memberships_self_read on public.store_memberships
  for select to authenticated using (user_id = (select auth.uid()));
create policy store_memberships_admin_read on public.store_memberships
  for select to authenticated using (
    private.has_store_membership(store_id, array['admin'])
    or exists (select 1 from public.stores store where store.id = store_id
      and private.is_org_member(store.organization_id, array['owner','admin']))
  );
create policy store_memberships_admin_insert on public.store_memberships
  for insert to authenticated with check (
    private.has_store_membership(store_id, array['admin'])
    or exists (select 1 from public.stores store where store.id = store_id
      and private.is_org_member(store.organization_id, array['owner','admin']))
  );
create policy store_memberships_admin_update on public.store_memberships
  for update to authenticated using (
    private.has_store_membership(store_id, array['admin'])
    or exists (select 1 from public.stores store where store.id = store_id
      and private.is_org_member(store.organization_id, array['owner','admin']))
  ) with check (
    private.has_store_membership(store_id, array['admin'])
    or exists (select 1 from public.stores store where store.id = store_id
      and private.is_org_member(store.organization_id, array['owner','admin']))
  );
create policy store_memberships_admin_delete on public.store_memberships
  for delete to authenticated using (
    private.has_store_membership(store_id, array['admin'])
    or exists (select 1 from public.stores store where store.id = store_id
      and private.is_org_member(store.organization_id, array['owner','admin']))
  );

create policy invitation_store_admin_read on public.organization_invitations
  for select to authenticated using (
    store_id is not null and (
      private.has_store_membership(store_id, array['admin'])
      or exists (select 1 from public.stores store where store.id = store_id
        and private.is_org_member(store.organization_id, array['owner','admin']))
    )
  );

create policy organizations_select_store_member on public.organizations
  for select to authenticated using (private.has_store_membership_in_organization(id));

create policy stores_select_store_member on public.stores
  for select to authenticated using (private.has_store_membership(id));
create policy stores_update_store_admin on public.stores
  for update to authenticated using (private.has_store_membership(id, array['admin']))
  with check (private.has_store_membership(id, array['admin']));

-- Add store-filtered access alongside the existing workspace policies. Roles
-- only see rows belonging to stores they were explicitly invited to.
do $$
declare
  table_row record;
  read_roles text[];
begin
  for table_row in
    select c.table_name
    from information_schema.columns c
    join pg_class relation on relation.relname = c.table_name
    join pg_namespace namespace on namespace.oid = relation.relnamespace and namespace.nspname = 'public'
    where c.table_schema = 'public' and c.column_name = 'store_id'
      and relation.relkind in ('r', 'p') and relation.relrowsecurity
      and c.table_name not in ('store_memberships', 'organization_invitations')
  loop
    read_roles := array['owner','admin','analyst','connector','viewer'];
    if table_row.table_name in ('shopify_customers','shopify_orders','shopify_order_lines',
      'shopify_refunds','shopify_refund_lines','shopify_transactions','shopify_order_attribution') then
      read_roles := array['owner','admin','analyst','connector'];
    end if;
    if table_row.table_name in ('connection_secret_audit_events', 'product_cost_audit_events') then
      read_roles := array['admin'];
    end if;

    if exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = table_row.table_name and cmd in ('SELECT', 'ALL')) then
      execute format(
        'create policy store_scope_read on public.%I for select to authenticated using (private.has_store_membership(store_id, %L::text[]))',
        table_row.table_name, read_roles
      );
    end if;

    -- Match the table's existing write surface. Audit records and report
    -- ownership rules must not become editable just because a role is admin.
    if table_row.table_name not in ('data_connections', 'connection_secret_audit_events',
      'product_cost_audit_events', 'saved_reports', 'saved_report_runs', 'saved_report_revisions') then
      if exists (select 1 from pg_policies where schemaname = 'public'
        and tablename = table_row.table_name and cmd in ('INSERT', 'ALL')) then
        execute format('create policy store_scope_admin_insert on public.%I for insert to authenticated with check (private.has_store_membership(store_id, array[''admin'']))', table_row.table_name);
      end if;
      if exists (select 1 from pg_policies where schemaname = 'public'
        and tablename = table_row.table_name and cmd in ('UPDATE', 'ALL')) then
        execute format('create policy store_scope_admin_update on public.%I for update to authenticated using (private.has_store_membership(store_id, array[''admin''])) with check (private.has_store_membership(store_id, array[''admin'']))', table_row.table_name);
      end if;
      if exists (select 1 from pg_policies where schemaname = 'public'
        and tablename = table_row.table_name and cmd in ('DELETE', 'ALL')) then
        execute format('create policy store_scope_admin_delete on public.%I for delete to authenticated using (private.has_store_membership(store_id, array[''admin'']))', table_row.table_name);
      end if;
    end if;
  end loop;
end $$;

-- Store-scoped connections managers may administer credentials for their own
-- store. Reporting rows remain read-only for this role.
do $$
declare connector_table_name text;
begin
  foreach connector_table_name in array array[
    'revenue_connector_settings', 'google_ads_accounts',
    'bing_ads_accounts', 'gohighlevel_reporting_configs'
  ] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public'
      and columns.table_name = connector_table_name and column_name = 'store_id') then
      execute format(
        'create policy %I on public.%I for all to authenticated using (store_id is not null and private.has_store_membership(store_id, array[''connector''])) with check (store_id is not null and private.has_store_membership(store_id, array[''connector'']))',
        'store_scope_connector_manage', connector_table_name
      );
    end if;
  end loop;
end $$;

create or replace function public.accept_organization_invitation(invite_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invite public.organization_invitations%rowtype;
  caller_id uuid := (select auth.uid());
  caller_email text;
begin
  if caller_id is null or invite_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation';
  end if;
  select lower(email) into caller_email from auth.users
    where id = caller_id and email_confirmed_at is not null;
  if caller_email is null then raise exception 'Confirm your email before accepting this invitation'; end if;
  select * into invite from public.organization_invitations
    where token_hash = invite_token_hash for update;
  if invite.id is null or invite.store_id is null or invite.expires_at <= now()
     or invite.accepted_at is not null or invite.revoked_at is not null
     or invite.email <> caller_email then
    raise exception 'This invitation is invalid, expired or belongs to a different email';
  end if;
  if not exists (select 1 from public.stores store
    where store.id = invite.store_id and store.organization_id = invite.organization_id) then
    raise exception 'This invitation does not match the selected store';
  end if;
  if exists (select 1 from public.organization_members
    where organization_id = invite.organization_id and user_id = caller_id) then
    raise exception 'You already have access to this workspace';
  end if;
  if exists (select 1 from public.store_memberships
    where store_id = invite.store_id and user_id = caller_id) then
    raise exception 'You already belong to this store';
  end if;
  insert into public.store_memberships(store_id, user_id, email, role)
    values (invite.store_id, caller_id, caller_email, invite.role);
  update public.organization_invitations
    set accepted_at = now(), accepted_by = caller_id where id = invite.id;
  return invite.store_id;
end;
$$;
revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;
