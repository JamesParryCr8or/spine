-- Workspace roles are fixed for now; permissions are data so the UI and API share one catalogue.
create table public.organization_roles (
  key text primary key,
  label text not null,
  description text not null,
  can_view_reports boolean not null default true,
  can_view_customer_details boolean not null default false,
  can_manage_data boolean not null default false,
  can_manage_connections boolean not null default false,
  can_manage_team boolean not null default false
);
insert into public.organization_roles (key,label,description,can_view_customer_details,can_manage_data,can_manage_connections,can_manage_team) values
  ('owner','Owner','Full workspace control, including team and connections.',true,true,true,true),
  ('admin','Admin','Manage the team, data and connections.',true,true,true,true),
  ('analyst','Analyst','Explore reports and customer details without changing data.',true,false,false,false),
  ('connector','Connections manager','Manage integrations and tokens without editing reports or team access.',false,false,true,false),
  ('viewer','Viewer','View reports with customer details hidden.',false,false,false,false);
alter table public.organization_roles enable row level security;
revoke all on public.organization_roles from anon, authenticated;
grant select on public.organization_roles to authenticated;
create policy roles_read on public.organization_roles for select to authenticated using (true);

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_fkey foreign key (role) references public.organization_roles(key);
alter table public.organization_members add column email text;
update public.organization_members m set email = lower(u.email) from auth.users u where u.id = m.user_id;

create or replace function private.sync_member_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.organization_members set email = lower(new.email) where user_id = new.id;
  return new;
end;
$$;
revoke all on function private.sync_member_email() from public;
create trigger sync_member_email after update of email on auth.users for each row
  when (old.email is distinct from new.email) execute function private.sync_member_email();

create or replace function private.set_member_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select lower(email) into new.email from auth.users where id = new.user_id;
  return new;
end;
$$;
revoke all on function private.set_member_email() from public;
create trigger set_member_email before insert or update of user_id on public.organization_members
  for each row execute function private.set_member_email();

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  role text not null references public.organization_roles(key) check (role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);
create index organization_invitations_org_idx on public.organization_invitations(organization_id, created_at desc);
create unique index organization_invitations_pending_email_idx on public.organization_invitations(organization_id,email)
  where accepted_at is null and revoked_at is null;
alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from anon, authenticated;
grant select on public.organization_invitations to authenticated;
create policy invitation_admin_read on public.organization_invitations for select to authenticated
  using ((select private.is_org_member(organization_id, array['owner','admin'])));

-- The invitee cannot read the invitation row. This narrowly-scoped RPC checks their
-- verified Auth email and consumes the token and membership in one transaction.
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
  if invite.id is null or invite.expires_at <= now() or invite.accepted_at is not null
     or invite.revoked_at is not null or invite.email <> caller_email then
    raise exception 'This invitation is invalid, expired or belongs to a different email';
  end if;
  if exists (select 1 from public.organization_members
             where organization_id = invite.organization_id and user_id = caller_id) then
    raise exception 'You already belong to this workspace';
  end if;
  insert into public.organization_members(organization_id,user_id,role)
    values (invite.organization_id,caller_id,invite.role);
  update public.organization_invitations
    set accepted_at = now(), accepted_by = caller_id where id = invite.id;
  return invite.organization_id;
end;
$$;
revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;

-- Extend credential operations to the dedicated connections manager. Finance
-- imports and cost-setting policies intentionally retain owner/admin checks.
do $$
declare p record; definition text; updated text;
begin
  for p in select function_row.oid from pg_proc function_row join pg_namespace n on n.oid = function_row.pronamespace
    where n.nspname = 'public' and function_row.proname in (
      'save_data_connection', 'delete_data_connection', 'record_shopify_connection_scopes',
      'select_google_ads_connection', 'mark_connection_error', 'read_connection_secret')
  loop
    definition := pg_get_functiondef(p.oid);
    updated := replace(replace(definition,
      'role in (''owner'', ''admin'')', 'role in (''owner'', ''admin'', ''connector'')'),
      'role in (''owner'',''admin'')', 'role in (''owner'',''admin'',''connector'')');
    if definition = updated then raise exception 'Credential function % has no role check to extend', p.oid; end if;
    execute updated;
  end loop;
end $$;

drop policy if exists admin_insert on public.revenue_connector_settings;
drop policy if exists admin_update on public.revenue_connector_settings;
drop policy if exists admin_delete on public.revenue_connector_settings;
create policy connector_insert on public.revenue_connector_settings for insert to authenticated
  with check (exists (select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id,array['owner','admin','connector'])));
create policy connector_update on public.revenue_connector_settings for update to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id,array['owner','admin','connector'])))
  with check (exists (select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id,array['owner','admin','connector'])));
create policy connector_delete on public.revenue_connector_settings for delete to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and private.is_org_member(s.organization_id,array['owner','admin','connector'])));

create policy ghl_connector_manage on public.gohighlevel_reporting_configs for all to authenticated
  using ((select private.is_org_member(organization_id,array['connector'])))
  with check ((select private.is_org_member(organization_id,array['connector'])));
