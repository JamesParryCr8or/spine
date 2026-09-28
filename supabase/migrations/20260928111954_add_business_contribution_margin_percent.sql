alter table public.store_cost_defaults
  add column if not exists business_contribution_margin_percent numeric(7,4) not null default 0
  check (business_contribution_margin_percent >= 0 and business_contribution_margin_percent <= 100);
