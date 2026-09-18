-- Run after applying supabase/setup.sql and every migration.
-- The block fails if a public table is exposed without RLS, an UPDATE policy
-- can move rows outside its authorization boundary, or a policy is granted
-- directly to anon/public.
do $$
declare
  failures text;
begin
  select string_agg(format('%I.%I', namespace.nspname, relation.relname), ', ' order by relation.relname)
  into failures
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and not relation.relrowsecurity;

  if failures is not null then
    raise exception 'Public tables without RLS: %', failures;
  end if;

  select string_agg(format('%I.%I', schemaname, tablename || ':' || policyname), ', ' order by tablename, policyname)
  into failures
  from pg_policies
  where schemaname = 'public'
    and cmd = 'UPDATE'
    and (qual is null or with_check is null);

  if failures is not null then
    raise exception 'UPDATE policies missing USING or WITH CHECK: %', failures;
  end if;

  select string_agg(format('%I.%I', schemaname, tablename || ':' || policyname), ', ' order by tablename, policyname)
  into failures
  from pg_policies
  where schemaname = 'public'
    and (roles @> array['anon']::name[] or roles @> array['public']::name[]);

  if failures is not null then
    raise exception 'Public policies granted to anon/public: %', failures;
  end if;
end
$$;
