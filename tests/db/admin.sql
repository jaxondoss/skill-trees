-- Admin view (setSkillCategory): moving a skill between categories stays inside one user.
-- The action reads both rows under RLS first; these checks pin the database's own guarantees under it.
\set ON_ERROR_STOP on
\set c '''adad0000-0000-4000-8000-0000000000c1'''
\set d '''adad0000-0000-4000-8000-0000000000d2'''

insert into auth.users (id, email) values (:c, 'c@test'), (:d, 'd@test');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :c, true) \g /dev/null
select public.seed_user(current_setting('forge.template')::jsonb) \g /dev/null
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :d, true) \g /dev/null
select public.seed_user(current_setting('forge.template')::jsonb) \g /dev/null
commit;

-- C moves their own skill to another of their own categories.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :c, true) \g /dev/null
do $$
declare s uuid; k uuid;
begin
  select id into s from public.skills where slug = 'reading';
  select id into k from public.categories where id <> (select category_id from public.skills where id = s) order by sort limit 1;
  update public.skills set category_id = k where id = s;
  assert (select category_id from public.skills where id = s) = k, 'own category move';
end $$;
commit;

-- C cannot point their skill at D's category (composite FK), nor touch D's skill (RLS: 0 rows).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :c, true) \g /dev/null
do $$
declare dcat uuid; n int;
begin
  set local role postgres;
  select id into dcat from public.categories where user_id = 'adad0000-0000-4000-8000-0000000000d2' limit 1;
  set local role authenticated;
  begin
    update public.skills set category_id = dcat where slug = 'reading';
    raise exception 'cross-user category move succeeded';
  exception when foreign_key_violation then null;
  end;
  update public.skills set category_id = (select id from public.categories limit 1)
    where user_id = 'adad0000-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  assert n = 0, 'C updated D''s skills';
end $$;
commit;

delete from auth.users where id in (:c, :d);
\echo 'Admin checks passed'
