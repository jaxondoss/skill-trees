-- Lyfta (renamed from the placeholder "lifta"), Strava, and Gemini join the integrations list.
update public.integrations set provider = 'lyfta' where provider = 'lifta';
alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('chess', 'google_calendar', 'canvas', 'lyfta', 'strava', 'claude', 'gemini'));
