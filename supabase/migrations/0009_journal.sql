-- Redesign: the journal (quick log saved to Mind) and step details.

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  body text not null check (length(body) between 1 and 1000),
  mood text check (mood in ('heavy', 'strained', 'steady', 'clear', 'locked_in')),
  created_at timestamptz not null default now()
);
create index journal_entries_user_idx on public.journal_entries (user_id, created_at desc);

alter table public.journal_entries enable row level security;
create policy journal_entries_select on public.journal_entries for select to authenticated using (user_id = (select auth.uid()));
create policy journal_entries_insert on public.journal_entries for insert to authenticated with check (user_id = (select auth.uid()));
create policy journal_entries_update on public.journal_entries for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy journal_entries_delete on public.journal_entries for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.journal_entries from anon;
grant select, insert, update, delete on public.journal_entries to authenticated;

-- Steps (milestones) get a details line, filled in from the skill page's to-do list.
alter table public.milestones add column if not exists note text check (length(note) <= 500);
