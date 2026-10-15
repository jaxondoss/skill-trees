-- Phase 3: the daily loop.

-- Swipe-left swap: replaces one open goal in a day's plan with another, once per day.
-- The replaced skill's open stretch goal goes with it. Returns the new goal's id.
create function public.swap_goal(p_day date, p_goal_id uuid, p_new jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_goal public.plan_goals;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'swap_goal requires a signed-in user';
  end if;

  select * into v_plan from public.daily_plans where user_id = v_uid and day = p_day for update;
  if not found then
    raise exception 'No plan for %', p_day using hint = 'no_plan';
  end if;
  if v_plan.swap_used then
    raise exception 'Swap already used today' using hint = 'swap_used';
  end if;

  select * into v_goal from public.plan_goals where id = p_goal_id and plan_id = v_plan.id;
  if not found or v_goal.kind = 'stretch' or v_goal.result_tier is not null then
    raise exception 'Goal cannot be swapped' using hint = 'not_swappable';
  end if;

  delete from public.plan_goals
  where plan_id = v_plan.id and (id = v_goal.id or (skill_id = v_goal.skill_id and kind = 'stretch' and result_tier is null));

  insert into public.plan_goals (user_id, plan_id, skill_id, non_negotiable_id, kind, tier, title, text, est_min,
                                 reason, engine_note, sort)
  values (v_uid, v_plan.id, (p_new ->> 'skillId')::uuid, (p_new ->> 'nonNegotiableId')::uuid, 'balance',
          p_new ->> 'tier', coalesce(p_new ->> 'title', ''), p_new ->> 'text', (p_new ->> 'estMin')::smallint,
          p_new ->> 'reason', p_new ->> 'note', v_goal.sort)
  returning id into v_id;

  update public.daily_plans set swap_used = true where id = v_plan.id;
  return v_id;
end;
$$;

revoke all on function public.swap_goal(date, uuid, jsonb) from public, anon;
grant execute on function public.swap_goal(date, uuid, jsonb) to authenticated;
