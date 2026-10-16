alter table public.store_cost_defaults add column cogs_method text not null default 'effective_dates' check (cogs_method in ('effective_dates', 'latest'));
