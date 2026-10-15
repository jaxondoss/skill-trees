-- Phase 6: integrations and the manual trackers that stand in for them.

-- One row per connected provider. config holds non-secret settings (username, base URL).
-- secret_ciphertext is encrypted by the server (AES-256-GCM, INTEGRATIONS_KEY) and never sent to the browser.
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('chess', 'google_calendar', 'canvas', 'lifta', 'claude')),
  status text not null default 'connected' check (status in ('connected', 'error')),
  config jsonb not null default '{}'::jsonb,
  secret_ciphertext text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- Assignments: entered by hand, or imported from Canvas once connected. Feed the 48-hour rule.
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course text,
  name text not null check (length(name) between 1 and 200),
  due_at timestamptz not null,
  started boolean not null default false,
  submitted boolean not null default false,
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index assignments_due_idx on public.assignments (user_id, due_at);

-- One-tap sleep log: "Going to sleep" opens a session, "Awake" closes it.
-- day is the night's day key (with the rollover, 1:30 AM still belongs to the evening before).
create table public.sleep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  slept_at timestamptz not null,
  woke_at timestamptz,
  created_at timestamptz not null default now(),
  check (woke_at is null or woke_at > slept_at)
);
create index sleep_sessions_day_idx on public.sleep_sessions (user_id, day);

do $$
declare t text;
begin
  foreach t in array array['integrations', 'assignments', 'sleep_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
