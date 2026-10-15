-- Phase 5: the figure tier the user has already celebrated, so a tier-up plays once.
alter table public.profiles add column seen_figure_tier smallint not null default 1 check (seen_figure_tier between 1 and 5);
