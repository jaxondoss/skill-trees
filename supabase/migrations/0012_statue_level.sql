-- FORGE v3.4: the statue's level. The plaque on the knight's pedestal shows progress from the current level to the
-- next; at 100% the owner presses UPGRADE (no auto-upgrade). A level, once reached, never drops, even when the
-- overall score falls back. Null until the room first loads, which sets it to the score's whole part.
alter table public.profiles add column statue_level integer check (statue_level between 0 and 100);

create or replace function public.statue_level_never_drops() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- signed-in users only (as the rack lock): an admin reset may clear it
  if auth.uid() is not null and old.statue_level is not null
     and (new.statue_level is null or new.statue_level < old.statue_level) then
    raise exception 'The statue level never drops (% to %)', old.statue_level, new.statue_level
      using errcode = 'P0001', hint = 'statue_level_drop';
  end if;
  return new;
end $$;

create trigger profiles_statue_level_never_drops
  before update of statue_level on public.profiles
  for each row execute function public.statue_level_never_drops();
