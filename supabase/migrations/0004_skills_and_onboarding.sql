-- Phase 4: skill pages, milestone proof, onboarding.

-- The tip tier the user has already seen, so crossing 34 or 67 shows "New guidance unlocked" once.
alter table public.skills add column seen_tip_tier text not null default 'foundation'
  check (seen_tip_tier in ('foundation', 'development', 'mastery'));

-- First-run onboarding in one transaction:
-- claims confirmed milestones, records baselines, sets the rack (locked 7 days),
-- updates the weekly schedule and chess account, writes the focus line, and
-- clears today's untouched plan so it regenerates with the chosen rack.
create function public.complete_onboarding(p_day date, p jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tpl uuid;
  v_slot smallint := 0;
  v_skill uuid;
  v_day jsonb;
begin
  if v_uid is null then
    raise exception 'complete_onboarding requires a signed-in user';
  end if;
  if jsonb_array_length(coalesce(p -> 'rack', '[]'::jsonb)) > 5 then
    raise exception 'The rack holds at most 5 skills';
  end if;

  update public.milestones set claimed_at = now()
  where user_id = v_uid and claimed_at is null
    and id in (select (jsonb_array_elements_text(coalesce(p -> 'claims', '[]'::jsonb)))::uuid);

  insert into public.metrics (user_id, skill_id, key, value, day, source)
  select v_uid, (m ->> 'skillId')::uuid, m ->> 'key', (m ->> 'value')::numeric, p_day, 'onboarding'
  from jsonb_array_elements(coalesce(p -> 'metrics', '[]'::jsonb)) as m
  where m ->> 'value' is not null;

  delete from public.rack_pins where user_id = v_uid;
  for v_skill in select (jsonb_array_elements_text(coalesce(p -> 'rack', '[]'::jsonb)))::uuid loop
    v_slot := v_slot + 1;
    insert into public.rack_pins (user_id, slot, skill_id, locked_until)
    values (v_uid, v_slot, v_skill, now() + interval '7 days');
  end loop;

  select id into v_tpl from public.schedule_templates where user_id = v_uid and is_active;
  for v_day in select * from jsonb_array_elements(coalesce(p -> 'schedule', '[]'::jsonb)) loop
    update public.schedule_days
    set day_type = coalesce(v_day ->> 'dayType', day_type),
        training_time = case when v_day ? 'trainingTime' then (v_day ->> 'trainingTime')::time else training_time end
    where template_id = v_tpl and weekday = (v_day ->> 'weekday')::smallint;
  end loop;

  if p ? 'chess' then
    update public.skills set config = config || jsonb_build_object(
      'platform', p #>> '{chess,platform}', 'username', nullif(p #>> '{chess,username}', ''))
    where user_id = v_uid and slug = 'chess';
  end if;

  update public.profiles
  set focus_line = nullif(trim(p ->> 'focusLine'), ''), onboarded_at = now()
  where user_id = v_uid;

  delete from public.daily_plans d
  where d.user_id = v_uid and d.day = p_day
    and not exists (select 1 from public.plan_goals g where g.plan_id = d.id and g.result_tier is not null);
end;
$$;

revoke all on function public.complete_onboarding(date, jsonb) from public, anon;
grant execute on function public.complete_onboarding(date, jsonb) to authenticated;

-- Proof photos and art: a private bucket, each user limited to their own folder.
-- Guarded so plain Postgres (local tests) without Supabase Storage still migrates.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false) on conflict (id) do nothing;
    execute $p$
      create policy "proofs owner read" on storage.objects for select to authenticated
        using (bucket_id = 'proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "proofs owner write" on storage.objects for insert to authenticated
        with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "proofs owner delete" on storage.objects for delete to authenticated
        using (bucket_id = 'proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
  end if;
end;
$$;
