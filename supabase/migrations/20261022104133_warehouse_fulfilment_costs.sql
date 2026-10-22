alter table public.store_cost_defaults add column warehouse_costs jsonb not null default '[]'::jsonb check (jsonb_typeof(warehouse_costs) = 'array');
