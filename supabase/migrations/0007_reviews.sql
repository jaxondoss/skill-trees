-- Phase 7: weekly and monthly reviews.

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  completion_pct numeric(5, 2),
  kept_days smallint,
  obstacle text check (length(obstacle) <= 1000),
  focus_line text check (length(focus_line) <= 80),
  -- Difficulty suggestions and what was decided: [{ nonNegotiableId, kind, accepted }]
  decisions jsonb not null default '[]'::jsonb,
  debrief text,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  -- "Does this number feel true?" per skill: { skillId: "too_high" | "right" | "too_low" }
  calibrations jsonb not null default '{}'::jsonb,
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

do $$
declare t text;
begin
  foreach t in array array['weekly_reviews', 'monthly_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
