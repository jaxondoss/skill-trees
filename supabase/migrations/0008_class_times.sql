-- Confirmed class times (Jaxon, 2026-10-17): CMPS 1500 runs 5:00 to 6:00 PM on Mon, Wed and Fri (the
-- Thursday lab is 5:00 to 6:15), and ARCH 1110 is 11:00 to 12:15 on Tue and Thu. The seed had marked
-- both as "confirm" because they were read from a planner grid.
--
-- Only rows that still carry the seed's confirm flag change, so a schedule edited by hand is left alone.
-- Safe to run more than once.
update public.schedule_days d
set classes = (
  select jsonb_agg(
    case
      when c ->> 'course' = 'CMPS 1500' and c ->> 'end' = '17:50' then (c - 'confirm') || jsonb_build_object('end', '18:00')
      when c ? 'confirm' then c - 'confirm'
      else c
    end
    order by t.ord)
  from jsonb_array_elements(d.classes) with ordinality as t(c, ord)
)
where d.classes @> '[{"confirm": true}]'::jsonb;
