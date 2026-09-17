revoke all on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists shopify_order_attribution_org_idx
  on public.shopify_order_attribution(organization_id);
create index if not exists shopify_order_lines_org_idx
  on public.shopify_order_lines(organization_id);
create index if not exists shopify_refund_lines_order_line_idx
  on public.shopify_refund_lines(order_line_id);
create index if not exists shopify_refund_lines_org_idx
  on public.shopify_refund_lines(organization_id);
create index if not exists shopify_refunds_org_idx
  on public.shopify_refunds(organization_id);
