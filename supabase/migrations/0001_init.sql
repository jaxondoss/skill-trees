-- FORGE initial schema.
-- Every table carries user_id and is locked to its owner with RLS.
-- Child tables reference parents by (user_id, id) so a row can never point at another user's data.

create extension if not exists pgcrypto;

-- ───────────────────────────── profiles
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Chicago',
  rollover_hour smallint not null default 4 check (rollover_hour between 0 and 12),
  daily_budget_min integer not null default 120 check (daily_budget_min between 0 and 1440),
  sound_on boolean not null default true,
  focus_line text,
  seed_version integer,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── categories and skills
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text,
  region text not null check (region in ('head', 'left_arm', 'right_arm', 'left_leg_core', 'right_leg_chest')),
  position text not null check (position in ('top_left', 'top_right', 'top_center', 'bottom_left', 'bottom_right')),
  goal_weight numeric(3, 2) not null default 1.0 check (goal_weight > 0),
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (user_id, id)
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null,
  slug text not null,
  name text not null,
  identity text not null default '',
  hundred_means text not null default '',
  metrics_note text,
  priority_weight smallint not null default 2 check (priority_weight between 1 and 3),
  status text not null default 'active' check (status in ('active', 'dormant', 'archived')),
  final_score numeric(5, 2),
  archived_at timestamptz,
  tips jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (user_id, id),
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete cascade
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skill_id uuid not null,
  title text not null,
  points smallint not null check (points > 0 and points <= 100),
  type text not null check (type in ('manual', 'metric', 'streak', 'count')),
  rule jsonb,
  suggest_claim boolean not null default false,
  sort smallint not null default 0,
  claimed_at timestamptz,
  proof_url text,
  proof_value numeric,
  created_at timestamptz not null default now(),
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete cascade
);

create table public.non_negotiables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skill_id uuid not null,
  name text not null,
  floor_text text not null,
  standard_text text not null,
  stretch_text text not null,
  floor_min smallint not null default 0 check (floor_min >= 0),
  standard_min smallint not null default 0 check (standard_min >= 0),
  stretch_min smallint not null default 0 check (stretch_min >= 0),
  counts_against_budget boolean not null default true,
  intention text not null default '',
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}' check (days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[]),
  day_types text[] check (day_types <@ '{class_light,class_heavy,weekend,break}'::text[]),
  default_tier text not null default 'standard' check (default_tier in ('floor', 'standard', 'stretch')),
  active boolean not null default true,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete cascade
);

-- ───────────────────────────── schedule
create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index schedule_templates_one_active on public.schedule_templates (user_id) where is_active;

create table public.schedule_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  day_type text not null check (day_type in ('class_light', 'class_heavy', 'weekend', 'break')),
  classes jsonb not null default '[]'::jsonb,
  training_time time,
  notes text,
  unique (template_id, weekday),
  foreign key (user_id, template_id) references public.schedule_templates (user_id, id) on delete cascade
);

create table public.day_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('exam_week', 'race_week', 'sick', 'travel')),
  starts_on date not null,
  ends_on date not null,
  note text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.key_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('race', 'exam', 'other')),
  label text not null,
  date date,
  tentative boolean not null default false,
  skill_id uuid,
  goal text,
  created_at timestamptz not null default now(),
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete set null (skill_id)
);

-- ───────────────────────────── focus rack
create table public.rack_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  skill_id uuid not null,
  pinned_at timestamptz not null default now(),
  locked_until timestamptz not null default (now() + interval '7 days'),
  unique (user_id, slot),
  unique (user_id, skill_id),
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete cascade
);

-- A pinned skill cannot be unpinned or swapped out while locked (spec 4.1 D).
-- Only enforced for signed-in requests, so account deletion cascades still work.
create function public.enforce_rack_lock() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and old.locked_until > now() then
    if tg_op = 'DELETE' or new.skill_id <> old.skill_id or new.locked_until < old.locked_until then
      raise exception 'Skill is locked in the rack until %', old.locked_until
        using errcode = 'P0001', hint = 'rack_locked';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger rack_pins_lock
  before update or delete on public.rack_pins
  for each row execute function public.enforce_rack_lock();

-- ───────────────────────────── daily plans and logging
create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  day_type text not null,
  overrides text[] not null default '{}',
  budget_min integer not null,
  planned_min integer not null default 0,
  over_budget boolean not null default false,
  swap_used boolean not null default false,
  generated_at timestamptz not null default now(),
  unique (user_id, day),
  unique (user_id, id)
);

create table public.plan_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null,
  skill_id uuid not null,
  non_negotiable_id uuid,
  kind text not null check (kind in ('rack', 'balance', 'stretch')),
  tier text not null check (tier in ('floor', 'standard', 'stretch')),
  text text not null,
  est_min smallint not null default 0,
  reason text,
  engine_note text,
  sort smallint not null default 0,
  result_tier text check (result_tier in ('floor', 'standard', 'stretch')),
  completed_at timestamptz,
  user_note text,
  swapped_from uuid references public.plan_goals (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((result_tier is null) = (completed_at is null)),
  foreign key (user_id, plan_id) references public.daily_plans (user_id, id) on delete cascade,
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete cascade,
  foreign key (user_id, non_negotiable_id) references public.non_negotiables (user_id, id) on delete set null (non_negotiable_id)
);
create index plan_goals_skill_idx on public.plan_goals (user_id, skill_id, created_at desc);

create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skill_id uuid,
  key text not null,
  value numeric not null,
  unit text,
  day date not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'manual',
  meta jsonb not null default '{}'::jsonb,
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete cascade
);
create index metrics_key_idx on public.metrics (user_id, key, day desc);

create table public.skill_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skill_id uuid not null,
  day date not null,
  body text not null check (length(body) <= 500),
  created_at timestamptz not null default now(),
  foreign key (user_id, skill_id) references public.skills (user_id, id) on delete cascade
);

-- ───────────────────────────── scores and streaks
create table public.score_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  scope text not null check (scope in ('skill', 'category', 'overall')),
  ref_id uuid,
  score numeric(5, 2) not null check (score between 0 and 100),
  level numeric(5, 2),
  consistency numeric(5, 2),
  check ((scope = 'overall') = (ref_id is null))
);
create unique index score_snapshots_unique
  on public.score_snapshots (user_id, day, scope, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.daily_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  p numeric(5, 2) not null check (p between 0 and 100),
  n_core smallint not null,
  kept_streak boolean not null,
  primary key (user_id, day)
);

create table public.streak_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current integer not null default 0,
  best integer not null default 0,
  last_kept_day date,
  broken_on date,
  broken_length integer,
  break_seen boolean not null default true
);

-- ───────────────────────────── RLS: owner-only on every table
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'categories', 'skills', 'milestones', 'non_negotiables',
    'schedule_templates', 'schedule_days', 'day_overrides', 'key_dates', 'rack_pins',
    'daily_plans', 'plan_goals', 'metrics', 'skill_logs',
    'score_snapshots', 'daily_completions', 'streak_state'
  ] loop
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

-- ───────────────────────────── new user: profile and streak rows
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.streak_state (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── seed_user
-- Inserts the starting template (src/seed/template.ts, sent as JSON) for the
-- signed-in user in one transaction. Runs as the caller, so RLS still applies.
-- Idempotent: does nothing if the user already has categories.
create function public.seed_user(p_template jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cat jsonb;
  v_skill jsonb;
  v_ms jsonb;
  v_nn jsonb;
  v_day jsonb;
  v_kd jsonb;
  v_cat_id uuid;
  v_skill_id uuid;
  v_tpl_id uuid;
  v_slot smallint := 0;
  v_slug text;
  i integer;
  j integer;
begin
  if v_uid is null then
    raise exception 'seed_user requires a signed-in user';
  end if;

  perform pg_advisory_xact_lock(hashtext('seed_user:' || v_uid::text));
  if exists (select 1 from public.categories where user_id = v_uid) then
    return false;
  end if;

  update public.profiles set
    timezone = coalesce(p_template #>> '{profile,timezone}', timezone),
    rollover_hour = coalesce((p_template #>> '{profile,rolloverHour}')::smallint, rollover_hour),
    daily_budget_min = coalesce((p_template #>> '{profile,dailyBudgetMin}')::integer, daily_budget_min),
    seed_version = (p_template ->> 'version')::integer
  where user_id = v_uid;

  i := 0;
  for v_cat in select * from jsonb_array_elements(p_template -> 'categories') loop
    insert into public.categories (user_id, slug, name, color, icon, region, position, goal_weight, sort)
    values (v_uid, v_cat ->> 'slug', v_cat ->> 'name', v_cat ->> 'color', v_cat ->> 'icon',
            v_cat ->> 'region', v_cat ->> 'position', (v_cat ->> 'goalWeight')::numeric, i)
    returning id into v_cat_id;
    i := i + 1;

    j := 0;
    for v_skill in select * from jsonb_array_elements(v_cat -> 'skills') loop
      insert into public.skills (user_id, category_id, slug, name, identity, hundred_means, metrics_note,
                                 priority_weight, status, tips, config, sort)
      values (v_uid, v_cat_id, v_skill ->> 'slug', v_skill ->> 'name', v_skill ->> 'identity',
              v_skill ->> 'hundredMeans', v_skill ->> 'metricsNote',
              (v_skill ->> 'priorityWeight')::smallint, v_skill ->> 'status',
              coalesce(v_skill -> 'tips', '{}'::jsonb), coalesce(v_skill -> 'config', '{}'::jsonb), j)
      returning id into v_skill_id;
      j := j + 1;

      insert into public.milestones (user_id, skill_id, title, points, type, rule, suggest_claim, sort)
      select v_uid, v_skill_id, m.value ->> 'title', (m.value ->> 'points')::smallint, m.value ->> 'type',
             m.value -> 'rule', coalesce((m.value ->> 'suggestClaim')::boolean, false), (m.ordinality - 1)::smallint
      from jsonb_array_elements(v_skill -> 'milestones') with ordinality as m;

      insert into public.non_negotiables (user_id, skill_id, name, floor_text, standard_text, stretch_text,
                                          floor_min, standard_min, stretch_min, counts_against_budget, intention,
                                          days_of_week, day_types, default_tier, sort)
      select v_uid, v_skill_id, n.value ->> 'name', n.value ->> 'floor', n.value ->> 'standard', n.value ->> 'stretch',
             (n.value #>> '{minutes,floor}')::smallint, (n.value #>> '{minutes,standard}')::smallint,
             (n.value #>> '{minutes,stretch}')::smallint, (n.value ->> 'countsAgainstBudget')::boolean,
             n.value ->> 'intention',
             array(select jsonb_array_elements_text(n.value -> 'daysOfWeek')::smallint),
             case when n.value ? 'dayTypes' then array(select jsonb_array_elements_text(n.value -> 'dayTypes')) end,
             n.value ->> 'defaultTier', (n.ordinality - 1)::smallint
      from jsonb_array_elements(v_skill -> 'nonNegotiables') with ordinality as n;
    end loop;
  end loop;

  insert into public.schedule_templates (user_id, name, starts_on, ends_on, is_active)
  values (v_uid, p_template #>> '{schedule,name}', (p_template #>> '{schedule,startsOn}')::date,
          (p_template #>> '{schedule,endsOn}')::date, true)
  returning id into v_tpl_id;

  for v_day in select * from jsonb_array_elements(p_template #> '{schedule,days}') loop
    insert into public.schedule_days (user_id, template_id, weekday, day_type, classes, training_time, notes)
    values (v_uid, v_tpl_id, (v_day ->> 'weekday')::smallint, v_day ->> 'dayType',
            coalesce(v_day -> 'classes', '[]'::jsonb), (v_day ->> 'trainingTime')::time, v_day ->> 'notes');
  end loop;

  for v_kd in select * from jsonb_array_elements(p_template -> 'keyDates') loop
    insert into public.key_dates (user_id, kind, label, date, tentative, skill_id, goal)
    values (v_uid, v_kd ->> 'kind', v_kd ->> 'label', (v_kd ->> 'date')::date,
            coalesce((v_kd ->> 'tentative')::boolean, false),
            (select id from public.skills where user_id = v_uid and slug = v_kd ->> 'skillSlug'),
            v_kd ->> 'goal');
  end loop;

  -- Suggested rack. Onboarding lets the user change it; the 7-day lock starts on confirm.
  for v_slug in select jsonb_array_elements_text(p_template -> 'rack') loop
    v_slot := v_slot + 1;
    insert into public.rack_pins (user_id, slot, skill_id, locked_until)
    select v_uid, v_slot, id, now() from public.skills where user_id = v_uid and slug = v_slug;
  end loop;

  return true;
end;
$$;

revoke all on function public.seed_user(jsonb) from public, anon;
grant execute on function public.seed_user(jsonb) to authenticated;
