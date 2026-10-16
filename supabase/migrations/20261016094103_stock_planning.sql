-- Store-scoped draft purchase orders. Saving a draft never sends it or changes Shopify stock.
create table public.stock_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  reference text not null check (length(reference) between 1 and 100),
  supplier text not null check (length(supplier) between 1 and 200),
  warehouse text not null check (length(warehouse) between 1 and 200),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  expected_date date,
  notes text not null default '' check (length(notes) <= 4000),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 1000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(store_id, reference)
);
create index stock_purchase_orders_store_idx on public.stock_purchase_orders(store_id, created_at desc);
alter table public.stock_purchase_orders enable row level security;
revoke all on public.stock_purchase_orders from anon, authenticated;
grant select, insert on public.stock_purchase_orders to authenticated;
create policy stock_po_read on public.stock_purchase_orders for select to authenticated using (
  private.has_store_membership(store_id) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id))
);
create policy stock_po_create on public.stock_purchase_orders for insert to authenticated with check (
  created_by = (select auth.uid()) and (private.has_store_membership(store_id,array['admin']) or exists(select 1 from public.stores s where s.id=store_id and private.is_org_member(s.organization_id,array['owner','admin'])))
);

-- One JSON result avoids the Data API row cap. Invoker preserves existing store RLS.
create function public.stock_demand(requested_store_id uuid, as_of timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
with eligible as (
 select l.variant_gid, l.quantity, l.current_quantity, l.shopify_gid, o.processed_at
 from public.shopify_order_lines l join public.shopify_orders o on o.id=l.order_id and o.store_id=l.store_id
 where l.store_id=requested_store_id and not o.test and o.cancelled_at is null
 and o.processed_at >= as_of-interval '90 days' and o.processed_at < as_of and l.variant_gid is not null
), refunds as (
 select r.line_item_gid, sum(r.quantity) as quantity from public.shopify_refund_lines r
 where r.store_id=requested_store_id and r.line_item_gid in (select shopify_gid from eligible) group by r.line_item_gid
), grouped as (
 select e.variant_gid as "variantId",
 coalesce(sum(e.quantity) filter(where processed_at>=as_of-interval '30 days'),0) as "sales30",
 coalesce(sum(e.quantity) filter(where processed_at>=as_of-interval '60 days'),0) as "sales60", sum(e.quantity) as "sales90",
 coalesce(sum(coalesce(r.quantity,0)) filter(where processed_at>=as_of-interval '30 days'),0) as "returns30",
 coalesce(sum(coalesce(r.quantity,0)) filter(where processed_at>=as_of-interval '60 days'),0) as "returns60", sum(coalesce(r.quantity,0)) as "returns90",
 coalesce(sum(greatest(e.current_quantity,0)) filter(where processed_at>=as_of-interval '30 days'),0) as "net30",
 coalesce(sum(greatest(e.current_quantity,0)) filter(where processed_at>=as_of-interval '60 days'),0) as "net60", sum(greatest(e.current_quantity,0)) as "net90"
 from eligible e left join refunds r on r.line_item_gid=e.shopify_gid group by e.variant_gid
) select coalesce(jsonb_agg(to_jsonb(grouped)), '[]'::jsonb) from grouped;
$$;
revoke all on function public.stock_demand(uuid,timestamptz) from public, anon;
grant execute on function public.stock_demand(uuid,timestamptz) to authenticated;
