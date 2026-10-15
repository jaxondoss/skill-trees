-- Phase 2: persisting today's plan and daily score snapshots.

-- Default skill-time budget is 125 minutes, so the default rack fits at Standard.
-- Profiles still on the untouched old default move with it.
alter table public.profiles alter column daily_budget_min set default 125;
update public.profiles set daily_budget_min = 125 where daily_budget_min = 120;

-- Goal title (the non-negotiable's name) is stored with the goal so past plans read correctly after edits.
alter table public.plan_goals add column title text not null default '';

-- Saves a generated plan for the signed-in user. First writer wins: if a plan for the
-- day already exists (another tab, a retry), it is kept and its id returned unchanged.
create function public.save_plan(p_day date, p_plan jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'save_plan requires a signed-in user';
  end if;

  insert into public.daily_plans (user_id, day, day_type, overrides, budget_min, planned_min, over_budget)
  values (
    v_uid, p_day, p_plan ->> 'dayType',
    array(select jsonb_array_elements_text(coalesce(p_plan -> 'overrides', '[]'::jsonb))),
    (p_plan ->> 'budgetMin')::integer, (p_plan ->> 'plannedMin')::integer, (p_plan ->> 'overBudget')::boolean
  )
  on conflict (user_id, day) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.daily_plans where user_id = v_uid and day = p_day;
    return v_id;
  end if;

  insert into public.plan_goals (user_id, plan_id, skill_id, non_negotiable_id, kind, tier, title, text,
                                 est_min, reason, engine_note, sort)
  select v_uid, v_id, (g.value ->> 'skillId')::uuid, (g.value ->> 'nonNegotiableId')::uuid,
         g.value ->> 'kind', g.value ->> 'tier', coalesce(g.value ->> 'title', ''), g.value ->> 'text',
         (g.value ->> 'estMin')::smallint, g.value ->> 'reason', g.value ->> 'note', (g.ordinality - 1)::smallint
  from jsonb_array_elements(p_plan -> 'goals') with ordinality as g;

  return v_id;
end;
$$;

-- Replaces the signed-in user's snapshots for one day. Called as the day goes on, so the
-- last write before rollover is that day's closing snapshot.
create function public.save_snapshots(p_day date, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'save_snapshots requires a signed-in user';
  end if;

  delete from public.score_snapshots where user_id = v_uid and day = p_day;
  insert into public.score_snapshots (user_id, day, scope, ref_id, score, level, consistency)
  select v_uid, p_day, r ->> 'scope', (r ->> 'refId')::uuid,
         round((r ->> 'score')::numeric, 2), round((r ->> 'level')::numeric, 2), round((r ->> 'consistency')::numeric, 2)
  from jsonb_array_elements(p_rows) as r;
end;
$$;

revoke all on function public.save_plan(date, jsonb) from public, anon;
revoke all on function public.save_snapshots(date, jsonb) from public, anon;
grant execute on function public.save_plan(date, jsonb) to authenticated;
grant execute on function public.save_snapshots(date, jsonb) to authenticated;
