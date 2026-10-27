-- save_plan and save_snapshots. Run by scripts/test-db.sh after rls.sql.
\set ON_ERROR_STOP on
\set c '''cccccccc-0000-0000-0000-000000000003'''
\set d '''dddddddd-0000-0000-0000-000000000004'''

insert into auth.users (id, email) values (:c, 'c@test'), (:d, 'd@test');

do $$ begin
  assert (select daily_budget_min from public.profiles where user_id = 'cccccccc-0000-0000-0000-000000000003') = 125,
    'new profiles default to a 125-minute budget';
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :c, true) \g /dev/null
select public.seed_user(current_setting('forge.template')::jsonb) \g /dev/null

do $$
declare
  v_skill uuid := (select id from public.skills where slug = 'strength');
  v_nn uuid := (select id from public.non_negotiables where skill_id = v_skill);
  v_plan jsonb;
  v_first uuid;
  v_second uuid;
begin
  v_plan := jsonb_build_object(
    'dayType', 'class_heavy', 'overrides', '[]'::jsonb, 'budgetMin', 125, 'plannedMin', 0, 'overBudget', false,
    'goals', jsonb_build_array(
      jsonb_build_object('skillId', v_skill, 'nonNegotiableId', v_nn, 'kind', 'rack', 'tier', 'standard',
                         'title', 'Training session', 'text', 'Full planned session', 'estMin', 75, 'reason', 'Rack', 'note', null),
      jsonb_build_object('skillId', v_skill, 'nonNegotiableId', v_nn, 'kind', 'stretch', 'tier', 'stretch',
                         'title', 'Training session', 'text', 'PR attempt', 'estMin', 90, 'reason', 'Stretch (optional)', 'note', null)
    ));

  v_first := public.save_plan('2026-10-20', v_plan);
  assert v_first is not null, 'plan saved';
  assert (select count(*) from public.plan_goals where plan_id = v_first) = 2, 'two goals saved';
  assert (select title from public.plan_goals where plan_id = v_first and sort = 0) = 'Training session', 'title saved';

  -- Second save for the same day keeps the first plan untouched.
  v_second := public.save_plan('2026-10-20', jsonb_set(v_plan, '{goals}', '[]'::jsonb));
  assert v_second = v_first, 'same plan id returned';
  assert (select count(*) from public.plan_goals where plan_id = v_first) = 2, 'goals unchanged on second save';

  -- Snapshots replace the day's rows.
  perform public.save_snapshots('2026-10-20', jsonb_build_array(
    jsonb_build_object('scope', 'skill', 'refId', v_skill, 'score', 41.234, 'level', 16, 'consistency', 100),
    jsonb_build_object('scope', 'overall', 'refId', null, 'score', 12.5, 'level', null, 'consistency', null)));
  perform public.save_snapshots('2026-10-20', jsonb_build_array(
    jsonb_build_object('scope', 'overall', 'refId', null, 'score', 13, 'level', null, 'consistency', null)));
  assert (select count(*) from public.score_snapshots where day = '2026-10-20') = 1, 'snapshots replaced';
  assert (select score from public.score_snapshots where scope = 'overall') = 13, 'latest snapshot kept';
end $$;
commit;

-- swap_goal: once per day, open core goals only.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true) \g /dev/null
do $$
declare
  v_plan uuid := (select id from public.daily_plans where day = '2026-10-20');
  v_rack uuid := (select id from public.plan_goals where plan_id = v_plan and kind = 'rack');
  v_chess uuid := (select id from public.skills where slug = 'chess');
  v_new uuid;
begin
  begin
    perform public.swap_goal('2026-10-20', (select id from public.plan_goals where plan_id = v_plan and kind = 'stretch'),
      jsonb_build_object('skillId', v_chess, 'tier', 'standard', 'text', 'x', 'estMin', 30));
    raise exception 'stretch goal was swapped';
  exception when raise_exception then
    if sqlerrm like 'stretch%' then raise; end if;
  end;

  v_new := public.swap_goal('2026-10-20', v_rack,
    jsonb_build_object('skillId', v_chess, 'tier', 'standard', 'title', 'Chess training', 'text', 'Puzzles', 'estMin', 30, 'reason', 'Swapped in'));
  assert (select skill_id from public.plan_goals where id = v_new) = v_chess, 'swapped goal inserted';
  assert (select count(*) from public.plan_goals where plan_id = v_plan) = 1, 'old goal and its stretch removed';
  assert (select swap_used from public.daily_plans where id = v_plan), 'swap marked used';

  begin
    perform public.swap_goal('2026-10-20', v_new, jsonb_build_object('skillId', v_chess, 'tier', 'floor', 'text', 'x', 'estMin', 10));
    raise exception 'second swap allowed';
  exception when raise_exception then
    if sqlerrm like 'second%' then raise; end if;
  end;
end $$;
commit;

-- User D cannot see or reuse C's plan, and a plan pointing at C's skill is rejected.
select set_config('forge.c_skill', (select id::text from public.skills where user_id = :c and slug = 'strength'), false) \g /dev/null
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :d, true) \g /dev/null
do $$ begin
  assert (select count(*) from public.daily_plans) = 0, 'D sees no plans';
  begin
    perform public.save_plan('2026-10-20', jsonb_build_object(
      'dayType', 'weekend', 'budgetMin', 125, 'plannedMin', 0, 'overBudget', false,
      'goals', jsonb_build_array(jsonb_build_object('skillId', current_setting('forge.c_skill'), 'nonNegotiableId', null,
        'kind', 'rack', 'tier', 'standard', 'text', 'x', 'estMin', 0))));
    raise exception 'cross-user plan goal saved';
  exception when foreign_key_violation then null;
  end;
end $$;
commit;

-- Signed out: both functions refuse.
begin;
set local role authenticated;
do $$ begin
  begin
    perform public.save_snapshots('2026-10-20', '[]'::jsonb);
    raise exception 'anonymous save succeeded';
  exception when raise_exception then
    if sqlerrm like 'anonymous%' then raise; end if;
  end;
end $$;
commit;

\echo 'Function checks passed'

-- complete_onboarding: claims, baselines, locked rack, focus line, today's plan reset.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true) \g /dev/null
do $$
declare
  v_claims jsonb := (select jsonb_agg(id) from public.milestones where suggest_claim);
  v_bench uuid := (select id from public.skills where slug = 'strength');
  v_rack jsonb := (select jsonb_agg(id order by slug) from public.skills where slug in ('chess', 'reading', 'strength'));
begin
  perform public.complete_onboarding('2026-10-20', jsonb_build_object(
    'claims', v_claims,
    'metrics', jsonb_build_array(jsonb_build_object('skillId', v_bench, 'key', 'bench_1rm', 'value', 240)),
    'rack', v_rack,
    'schedule', jsonb_build_array(jsonb_build_object('weekday', 6, 'dayType', 'weekend', 'trainingTime', '09:00')),
    'chess', jsonb_build_object('platform', 'lichess', 'username', 'jaxon'),
    'focusLine', 'Win the morning'));

  assert (select count(*) from public.milestones where claimed_at is not null) = 5, 'five milestones claimed';
  assert (select value from public.metrics where key = 'bench_1rm') = 240, 'baseline recorded';
  assert (select count(*) from public.rack_pins) = 3, 'rack replaced';
  assert (select bool_and(locked_until > now() + interval '6 days') from public.rack_pins), 'rack locked 7 days';
  assert (select training_time from public.schedule_days where weekday = 6) = '09:00', 'schedule updated';
  assert (select config ->> 'username' from public.skills where slug = 'chess') = 'jaxon', 'chess username saved';
  assert (select focus_line from public.profiles) = 'Win the morning', 'focus line saved';
  assert (select onboarded_at is not null from public.profiles), 'onboarded';
  -- The 2026-10-20 plan had no completed goal (it was swapped once, never logged), so it is cleared.
  assert not exists (select 1 from public.daily_plans where day = '2026-10-20'), 'untouched plan cleared';
end $$;
commit;

\echo 'Onboarding checks passed'

-- New tables are owner-only too: D cannot read C's assignments or write C's integrations.
insert into public.assignments (user_id, name, due_at) values ('cccccccc-0000-0000-0000-000000000003', 'Calc PS 5', now() + interval '1 day');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true) \g /dev/null
do $$ begin
  assert (select count(*) from public.assignments) = 0, 'D sees no assignments';
  begin
    insert into public.integrations (user_id, provider) values ('cccccccc-0000-0000-0000-000000000003', 'chess');
    raise exception 'inserted integration for another user';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
\echo 'Integration table checks passed'

-- The statue level only goes up.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true) \g /dev/null
do $$ begin
  update public.profiles set statue_level = 40;
  update public.profiles set statue_level = 41;
  assert (select statue_level from public.profiles) = 41, 'statue level raised';
  begin
    update public.profiles set statue_level = 40;
    raise exception 'statue level dropped';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'The statue level never drops%' then raise; end if;
  end;
end $$;
commit;
\echo 'Statue level checks passed'
