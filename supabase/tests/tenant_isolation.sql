-- Run against a disposable or development Supabase database.
-- Every fixture is contained in this transaction and rolled back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-owner-a@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"company_name":"RLS owner A"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-4000-8000-0000000000b2',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-member-b@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"company_name":"RLS member B"}'::jsonb, now(), now()
  );

select set_config(
  'test.owner_org_id',
  (select id::text from public.organizations where created_by = '00000000-0000-4000-8000-0000000000a1'),
  true
);
select set_config(
  'test.other_org_id',
  (select id::text from public.organizations where created_by = '00000000-0000-4000-8000-0000000000b2'),
  true
);

insert into public.organization_members (organization_id, user_id, role)
values (
  current_setting('test.owner_org_id')::uuid,
  '00000000-0000-4000-8000-0000000000b2',
  'viewer'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  affected integer;
begin
  if not exists (
    select 1 from public.organizations
    where id = current_setting('test.owner_org_id')::uuid
  ) then
    raise exception 'Owner cannot read their organization';
  end if;

  if exists (
    select 1 from public.organizations
    where id = current_setting('test.other_org_id')::uuid
  ) then
    raise exception 'Owner can read another organization';
  end if;

  if exists (
    select 1 from public.profiles
    where user_id = '00000000-0000-4000-8000-0000000000b2'
  ) then
    raise exception 'User can read another profile';
  end if;

  update public.organizations
  set name = 'unauthorized'
  where id = current_setting('test.other_org_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Owner can update another organization';
  end if;

  begin
    insert into public.stores (organization_id, name)
    values (current_setting('test.other_org_id')::uuid, 'unauthorized');
    raise exception 'Owner can insert into another organization';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

do $$
declare
  affected integer;
begin
  if not exists (
    select 1 from public.organizations
    where id = current_setting('test.owner_org_id')::uuid
  ) then
    raise exception 'Viewer cannot read a shared organization';
  end if;

  update public.organizations
  set name = 'unauthorized viewer edit'
  where id = current_setting('test.owner_org_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Viewer can update an organization';
  end if;

  begin
    insert into public.stores (organization_id, name)
    values (current_setting('test.owner_org_id')::uuid, 'unauthorized viewer store');
    raise exception 'Viewer can insert a store';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
update public.organization_members
set role = 'analyst'
where organization_id = current_setting('test.owner_org_id')::uuid
  and user_id = '00000000-0000-4000-8000-0000000000b2';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

do $$
declare
  affected integer;
begin
  update public.organizations
  set name = 'unauthorized analyst edit'
  where id = current_setting('test.owner_org_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Analyst can update an organization';
  end if;

  begin
    insert into public.stores (organization_id, name)
    values (current_setting('test.owner_org_id')::uuid, 'unauthorized analyst store');
    raise exception 'Analyst can insert a store';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
update public.organization_members
set role = 'admin'
where organization_id = current_setting('test.owner_org_id')::uuid
  and user_id = '00000000-0000-4000-8000-0000000000b2';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

do $$
declare
  affected integer;
begin
  update public.organizations
  set name = 'RLS admin verified'
  where id = current_setting('test.owner_org_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Admin cannot update their organization';
  end if;

  insert into public.stores (organization_id, name)
  values (current_setting('test.owner_org_id')::uuid, 'RLS admin store');
end
$$;

reset role;
rollback;