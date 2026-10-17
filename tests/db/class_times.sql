-- 0008_class_times: confirms seeded class times once, and leaves edited schedules alone.
\set ON_ERROR_STOP on
\set e '''eeeeeeee-0000-0000-0000-000000000005'''

insert into auth.users (id, email) values (:e, 'e@test');
insert into public.schedule_templates (id, user_id, name, is_active)
values ('eeeeeeee-0000-0000-0000-0000000000a1', :e, 'Fall 2026', true);
insert into public.schedule_days (user_id, template_id, weekday, day_type, classes) values
  (:e, 'eeeeeeee-0000-0000-0000-0000000000a1', 1, 'class_light',
   '[{"course":"MATH 1210 Calc I","start":"12:00","end":"12:50"},{"course":"CMPS 1500","start":"17:00","end":"17:50","confirm":true}]'),
  (:e, 'eeeeeeee-0000-0000-0000-0000000000a1', 2, 'class_heavy',
   '[{"course":"ARCH 1110","start":"11:00","end":"12:15","confirm":true}]'),
  (:e, 'eeeeeeee-0000-0000-0000-0000000000a1', 3, 'class_light',
   '[{"course":"CMPS 1500","start":"17:00","end":"17:45"}]');

\ir ../../supabase/migrations/0008_class_times.sql
\ir ../../supabase/migrations/0008_class_times.sql

do $$
declare u uuid := 'eeeeeeee-0000-0000-0000-000000000005';
begin
  assert (select classes from public.schedule_days where user_id = u and weekday = 1)
    = '[{"course":"MATH 1210 Calc I","start":"12:00","end":"12:50"},{"course":"CMPS 1500","start":"17:00","end":"18:00"}]'::jsonb,
    'CMPS ends at 6:00 and loses the confirm flag; other classes keep their order';
  assert (select classes from public.schedule_days where user_id = u and weekday = 2)
    = '[{"course":"ARCH 1110","start":"11:00","end":"12:15"}]'::jsonb,
    'ARCH keeps 11:00 to 12:15 and loses the confirm flag';
  assert (select classes from public.schedule_days where user_id = u and weekday = 3)
    = '[{"course":"CMPS 1500","start":"17:00","end":"17:45"}]'::jsonb,
    'a schedule edited by hand is left alone';
end $$;

\echo 'Class time checks passed'
