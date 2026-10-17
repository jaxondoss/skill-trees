# Setup: Supabase and Vercel

About 10 minutes. The browser and server use the publishable key, and Row Level Security keeps every row private to its owner. There is no sign-in screen: the server signs in one owner account automatically with two server-only env vars, so the app opens straight to the dashboard. Anyone with the URL can open it, so keep the URL to yourself.

## 1. Supabase

1. Create a project at supabase.com (any region near Central US).
2. **SQL Editor:** paste and run `supabase/migrations/0001_init.sql`.
   With the Supabase CLI instead: `supabase link` then `supabase db push`.
3. **Authentication, Users:** Add user, Create new user, with your email and a password. Tick Auto confirm.
   If your email already exists (from an earlier magic link sign-in), keep that user so your data stays and give it a password instead (Send password recovery, or delete and recreate it if it holds nothing yet).
4. **Authentication, URL Configuration:** Site URL `https://YOUR-VERCEL-URL` (with `https://`). Not needed for sign-in any more, but a Site URL without the scheme breaks Supabase's own links.
5. **Project Settings, API Keys:** copy the Project URL and the publishable key (the legacy `anon` key also works).

## 2. Vercel

1. Import `jaxondoss/skill-trees` at vercel.com/new. Framework is detected as Next.js.
2. Environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `FORGE_OWNER_EMAIL` and `FORGE_OWNER_PASSWORD`: the user from Supabase step 3. Server only; never commit them or paste them in chat.
3. Deploy and open the URL. It lands on the dashboard. The first visit seeds your categories, skills, rack, and schedule with empty to-do lists. If the env vars are missing or the password is wrong, the app shows a setup page saying which.

## 3. Optional integrations

See Settings, Integrations in the app for what each one needs. Two server env vars cover the ones that need secrets:

- `INTEGRATIONS_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored tokens.
- `ANTHROPIC_API_KEY`: food photo analysis, weekly debrief, reading test generation. Without it those buttons stay hidden and everything has a manual path (quick-add meals, curated reading passages, the review without a debrief).

Chess needs neither: connect a public username on the Chess page.

## 4. Install on the phone

Open the deployed URL in Safari, Share, Add to Home Screen. It opens full screen. After one online visit the dashboard loads offline; goals you tap offline are kept on the phone and sync when you reconnect (within 36 hours, to the day you tapped them). Signing out clears the cached pages and any unsynced logs on that device.

## 5. Reviews

Sunday: the dashboard shows a review prompt until the weekly review is saved (focus line, difficulty decisions, store numbers). First Sunday of the month: the monthly review comes first (calibration, figure comparison, add or archive skills). Both are also linked at the bottom of the dashboard.

Data export: Settings, Data, Export everything (JSON).

## 6. Local development

```bash
cp .env.example .env.local   # fill in the two values
pnpm install
pnpm dev
```

## Checks

```bash
pnpm test        # Vitest: engines, seed integrity, copy rules
pnpm test:db     # migrations + RLS against a throwaway local Postgres (needs Postgres 15+ binaries)
pnpm test:e2e    # Playwright against a local stand-in for Supabase (Postgres + PostgREST + auth stub),
                 # booted by scripts/e2e-stack.sh. Set PW_CHROMIUM_PATH to use a preinstalled Chromium.
                 # E2E_MODE=start runs a production build, which also runs the offline (PWA) tests.
pnpm typecheck
pnpm lint
pnpm build
```
