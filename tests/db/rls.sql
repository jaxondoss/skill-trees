-- RLS and integrity checks. Run by scripts/test-db.sh after the migrations.
-- :template holds the seed template JSON. Any failed assertion raises and stops psql.
\set ON_ERROR_STOP on
\set a '''aaaaaaaa-0000-0000-0000-000000000001'''
\set b '''bbbbbbbb-0000-0000-0000-000000000002'''

insert into auth.users (id, email) values (:a, 'a@test'), (:b, 'b@test');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'signup trigger creates profiles';
  assert (select count(*) from public.streak_state) = 2, 'signup trigger creates streak rows';
end $$;

-- ── Seed both users through the real function, as themselves.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :a, true) \g /dev/null
do $$ begin assert public.seed_user(current_setting('forge.template')::jsonb), 'first seed returns true'; end $$;
do $$ begin assert not public.seed_user(current_setting('forge.template')::jsonb), 'second seed is a no-op'; end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :b, true) \g /dev/null
select public.seed_user(current_setting('forge.template')::jsonb) \g /dev/null
commit;

-- ── User A sees exactly their own seeded data.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :a, true) \g /dev/null
do $$
declare
  me uuid := auth.uid();
  t text;
  foreign_rows bigint;
begin
  assert (select count(*) from public.categories) = 5, 'A sees 5 categories';
  assert (select count(*) from public.skills) = 15, 'A sees 15 skills';
  assert (select count(*) from public.skills where status = 'active') = 14, '14 active skills';
  assert (select status from public.skills where slug = 'triathlon') = 'dormant', 'Triathlon is dormant';
  assert (select count(*) from public.rack_pins) = 5, 'A sees 5 rack pins';
  assert (select count(*) from public.schedule_days) = 7, 'A sees 7 schedule days';
  assert (select count(*) from public.profiles) = 1, 'A sees only own profile';
  assert not exists (
    select 1 from public.skills s
    where (select coalesce(sum(points), 0) from public.milestones m where m.skill_id = s.id) <> 100
  ), 'every skill milestones sum to 100';
  assert (select count(*) from public.milestones where suggest_claim) = 5, 'five onboarding suggestions';
  assert (select days_of_week from public.non_negotiables n join public.skills s on s.id = n.skill_id where s.slug = 'running')
    = '{2,4,6}'::smallint[], 'running scheduled Tue/Thu/Sat';

  foreach t in array array[
    'profiles', 'categories', 'skills', 'milestones', 'non_negotiables', 'schedule_templates',
    'schedule_days', 'day_overrides', 'key_dates', 'rack_pins', 'daily_plans', 'plan_goals',
    'metrics', 'skill_logs', 'score_snapshots', 'daily_completions', 'streak_state'
  ] loop
    execute format('select count(*) from public.%I where user_id <> $1', t) into foreign_rows using me;
    assert foreign_rows = 0, format('A can read other users rows in %s', t);
  end loop;
end $$;
commit;

-- ── A cannot modify B's rows: updates and deletes silently match nothing.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :a, true) \g /dev/null
do $$
declare n bigint;
begin
  with u as (update public.skills set name = 'hacked' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
  select count(*) into n from u;
  assert n = 0, 'A updated B skills';
  with d as (delete from public.milestones where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
  select count(*) into n from d;
  assert n = 0, 'A deleted B milestones';
end $$;
commit;

-- ── A cannot insert rows owned by B.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :a, true) \g /dev/null
do $$ begin
  begin
    insert into public.metrics (user_id, key, value, day) values ('bbbbbbbb-0000-0000-0000-000000000002', 'x', 1, current_date);
    raise exception 'insert as B succeeded';
  exception when insufficient_privilege then null; -- RLS violation (42501)
  end;
end $$;
commit;

-- ── A cannot point their own row at B's skill (composite foreign key).
-- B's skill id is read as superuser and handed in as a setting.
select set_config('forge.b_skill', (select id::text from public.skills where user_id = :b limit 1), false) \g /dev/null
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :a, true) \g /dev/null
do $$ begin
  begin
    insert into public.skill_logs (user_id, skill_id, day, body)
    values (auth.uid(), current_setting('forge.b_skill')::uuid, current_date, 'sneaky');
    raise exception 'cross-user reference succeeded';
  exception when foreign_key_violation then null;
  end;
end $$;
commit;

-- ── Rack lock: a locked pin cannot be removed or swapped; an expired one can.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :a, true) \g /dev/null
update public.rack_pins set locked_until = now() + interval '7 days' where slot = 1;
do $$ begin
  begin
    delete from public.rack_pins where slot = 1;
    raise exception 'locked pin was deleted';
  exception when raise_exception then
    if sqlerrm like 'locked pin%' then raise; end if;
  end;
  begin
    update public.rack_pins set skill_id = (select id from public.skills where slug = 'chess') where slot = 1;
    raise exception 'locked pin was swapped';
  exception when raise_exception then
    if sqlerrm like 'locked pin%' then raise; end if;
  end;
  begin
    update public.rack_pins set locked_until = now() where slot = 1;
    raise exception 'lock was shortened';
  exception when raise_exception then
    if sqlerrm like 'lock was%' then raise; end if;
  end;
  -- Slot 2 was seeded unlocked (onboarding confirms the rack), so it can change.
  delete from public.rack_pins where slot = 2;
  assert (select count(*) from public.rack_pins) = 4, 'unlocked pin removed';
end $$;
commit;

-- ── Account deletion still cascades through a locked pin (no signed-in user).
delete from auth.users where id = :b;
do $$ begin
  assert (select count(*) from public.skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0, 'B cascade deleted';
end $$;

-- ── anon has no table access at all.
begin;
set local role anon;
do $$ begin
  begin
    perform 1 from public.skills;
    raise exception 'anon read skills';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

\echo 'RLS checks passed'
