-- =====================================================================
-- Quackmaster Production Tracker — schema + seed
-- Uses a `qm_` prefix to avoid collision with the existing multi-location
-- `stock_levels` table in QuackDASH.
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. CLEANUP: undo the column/constraint changes the earlier attempt
--    made to the pre-existing public.stock_levels table.
--    All checks are defensive no-ops on a fresh DB.
-- ---------------------------------------------------------------------

-- Drop the single-column unique constraint we added (it would break
-- the one-row-per-item+location model used by the inventory module).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_levels'::regclass
      and conname  = 'stock_levels_item_id_key'
  ) then
    alter table public.stock_levels drop constraint stock_levels_item_id_key;
  end if;
end $$;

-- Drop the FK we added ONLY if it points to production_items (ours).
-- Leave the original FK (to items, or similar) untouched.
do $$
declare
  ref_name text;
begin
  select cl.relname into ref_name
  from pg_constraint c
  join pg_class cl on c.confrelid = cl.oid
  where c.conrelid = 'public.stock_levels'::regclass
    and c.conname  = 'stock_levels_item_id_fkey';

  if ref_name = 'production_items' or ref_name = 'qm_production_items' then
    alter table public.stock_levels drop constraint stock_levels_item_id_fkey;
  end if;
end $$;

-- Drop the `qty` column we added to stock_levels (safe: the original
-- inventory table uses `quantity`, not `qty`).
alter table public.stock_levels drop column if exists qty;

-- ---------------------------------------------------------------------
-- 1. qm_production_items
-- ---------------------------------------------------------------------
create table if not exists public.qm_production_items (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            text not null,                 -- protein | sauce | garnish | stock | noodle
  unit            text not null,                 -- kg | L | pcs
  max_qty         numeric not null default 0,
  schedule_days   text[] not null default '{}',  -- e.g. '{Mon,Wed,Fri}'
  schedule_label  text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_qm_production_items_type on public.qm_production_items(type);

-- ---------------------------------------------------------------------
-- 2. qm_stock_levels
-- ---------------------------------------------------------------------
create table if not exists public.qm_stock_levels (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.qm_production_items(id) on delete cascade,
  qty         numeric not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (item_id)
);

create index if not exists idx_qm_stock_levels_item on public.qm_stock_levels(item_id);

-- ---------------------------------------------------------------------
-- 3. qm_production_logs
-- ---------------------------------------------------------------------
create table if not exists public.qm_production_logs (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.qm_production_items(id) on delete cascade,
  planned_qty  numeric not null default 0,
  actual_qty   numeric not null default 0,
  note         text,
  logged_at    timestamptz not null default now(),
  logged_by    text
);

create index if not exists idx_qm_production_logs_item      on public.qm_production_logs(item_id);
create index if not exists idx_qm_production_logs_logged_at on public.qm_production_logs(logged_at desc);

-- ---------------------------------------------------------------------
-- 4. Row-level security (match the existing QuackDASH pattern)
-- ---------------------------------------------------------------------
alter table public.qm_production_items enable row level security;
alter table public.qm_stock_levels     enable row level security;
alter table public.qm_production_logs  enable row level security;

drop policy if exists "qm_production_items read"   on public.qm_production_items;
drop policy if exists "qm_production_items write"  on public.qm_production_items;
drop policy if exists "qm_stock_levels read"       on public.qm_stock_levels;
drop policy if exists "qm_stock_levels write"      on public.qm_stock_levels;
drop policy if exists "qm_production_logs read"    on public.qm_production_logs;
drop policy if exists "qm_production_logs write"   on public.qm_production_logs;

create policy "qm_production_items read"  on public.qm_production_items
  for select to authenticated using (true);
create policy "qm_production_items write" on public.qm_production_items
  for all    to authenticated using (true) with check (true);

create policy "qm_stock_levels read"  on public.qm_stock_levels
  for select to authenticated using (true);
create policy "qm_stock_levels write" on public.qm_stock_levels
  for all    to authenticated using (true) with check (true);

create policy "qm_production_logs read"  on public.qm_production_logs
  for select to authenticated using (true);
create policy "qm_production_logs write" on public.qm_production_logs
  for all    to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 5. Seed the 10 Quackmaster items (idempotent — keyed on name)
-- ---------------------------------------------------------------------
insert into public.qm_production_items (name, type, unit, max_qty, schedule_days, schedule_label)
select v.name, v.type, v.unit, v.max_qty, v.schedule_days, v.schedule_label
from (values
  ('Braised Duck (whole)',       'protein', 'pcs', 200::numeric, array['Mon','Wed','Fri'],                       'Mon · Wed · Fri'),
  ('Duck Broth (soup base)',     'stock',   'L',    80::numeric, array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],'Daily'),
  ('Sambal Chili Paste',         'sauce',   'kg',   30::numeric, array['Mon','Thu'],                              'Mon · Thu'),
  ('Chili Oil',                  'sauce',   'L',    20::numeric, array['Tue','Fri'],                              'Tue · Fri'),
  ('Fried Shallots',             'garnish', 'kg',   15::numeric, array['Mon','Wed','Fri'],                        'Mon · Wed · Fri'),
  ('Crispy Lard (Chu Yau Char)', 'garnish', 'kg',   12::numeric, array['Tue','Thu','Sat'],                        'Tue · Thu · Sat'),
  ('Garlic Oil',                 'sauce',   'L',    18::numeric, array['Mon','Thu'],                              'Mon · Thu'),
  ('Fish Cake (sliced)',         'protein', 'kg',   25::numeric, array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],'Daily'),
  ('Sweet Dark Sauce Mix',       'sauce',   'L',    15::numeric, array['Wed','Sat'],                              'Wed · Sat'),
  ('Pickled Green Chili',        'garnish', 'kg',   10::numeric, array['Mon'],                                    'Weekly (Mon)')
) as v(name, type, unit, max_qty, schedule_days, schedule_label)
where not exists (
  select 1 from public.qm_production_items pi where pi.name = v.name
);

-- Initialise a zero stock row for every item so the UI always has something to render.
insert into public.qm_stock_levels (item_id, qty)
select id, 0 from public.qm_production_items
on conflict (item_id) do nothing;
