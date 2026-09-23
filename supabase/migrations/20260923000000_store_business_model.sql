alter table public.stores
  add column if not exists business_model text not null default 'ecommerce'
  check (business_model in ('ecommerce', 'lead_generation'));
