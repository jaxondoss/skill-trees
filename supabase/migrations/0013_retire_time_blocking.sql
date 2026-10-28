-- FORGE v3.4: the calendar wall replaces Time Blocking. The skill is archived the way the app archives a skill
-- (status 'archived', archived_at, final_score from its latest snapshot), so its goals, logs and scores stay in
-- the history and the Trophy Room; it leaves the rack, and the room loses its object.
update public.skills s
set status = 'archived',
    archived_at = now(),
    final_score = coalesce(
      (select ss.score from public.score_snapshots ss
       where ss.scope = 'skill' and ss.ref_id = s.id order by ss.day desc limit 1),
      s.final_score, 0)
where s.slug = 'time-blocking' and s.status <> 'archived';

delete from public.rack_pins p
using public.skills s
where p.skill_id = s.id and s.slug = 'time-blocking';
