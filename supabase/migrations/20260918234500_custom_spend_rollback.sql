alter table public.custom_spend_import_batches
  add column if not exists previous_rows jsonb not null default '[]'::jsonb,
  add column if not exists rolled_back_at timestamptz,
  add column if not exists rolled_back_by uuid references auth.users(id) on delete restrict;

alter table public.custom_spend_import_batches
  drop constraint if exists custom_spend_import_batches_previous_rows_check;
alter table public.custom_spend_import_batches
  add constraint custom_spend_import_batches_previous_rows_check check (jsonb_typeof(previous_rows) = 'array');

create index if not exists custom_spend_batches_rolled_back_by_idx on public.custom_spend_import_batches (rolled_back_by);
