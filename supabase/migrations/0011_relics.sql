-- FORGE v3 room: relics. Long goals hung on one of three mounts in the room (left by the door, the niche
-- above the window, the right bracket by the gym). An achieved relic moves to the trophy case.
-- Progress is computed by the server: from metric_key against target, from a milestone, or from steps.
create table public.relics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slot text not null check (slot in ('left', 'window', 'right')),
  catalog_id text,
  title text not null check (length(title) between 1 and 60),
  skill_slug text,
  metric_key text,
  milestone_id uuid references public.milestones (id) on delete set null,
  target numeric,
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  deadline date,
  status text not null default 'active' check (status in ('active', 'achieved', 'abandoned')),
  achieved_at timestamptz,
  created_at timestamptz not null default now()
);
-- One active relic per mount.
create unique index relics_one_active_per_slot on public.relics (user_id, slot) where status = 'active';
create index relics_user_idx on public.relics (user_id, status);

alter table public.relics enable row level security;
create policy relics_select on public.relics for select to authenticated using (user_id = (select auth.uid()));
create policy relics_insert on public.relics for insert to authenticated with check (user_id = (select auth.uid()));
create policy relics_update on public.relics for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy relics_delete on public.relics for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.relics from anon;
grant select, insert, update, delete on public.relics to authenticated;
