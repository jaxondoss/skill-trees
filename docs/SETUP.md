# Setup: Supabase and Vercel

About 10 minutes. Nothing here needs a secret key in the app: the browser and server use the publishable key, and Row Level Security keeps every row private to its owner.

## 1. Supabase

1. Create a project at supabase.com (any region near Central US).
2. **SQL Editor:** paste and run `supabase/migrations/0001_init.sql`.
   With the Supabase CLI instead: `supabase link` then `supabase db push`.
3. **Authentication, Sign In / Providers:** Email is on by default. Magic links work out of the box.
4. **Authentication, URL Configuration:**
   - Site URL: your Vercel URL (for example `https://forge-xyz.vercel.app`)
   - Redirect URLs: add `https://YOUR-VERCEL-URL/auth/callback` and `http://localhost:3000/auth/callback`
5. **Project Settings, API Keys:** copy the Project URL and the publishable key (the legacy `anon` key also works).

## 2. Vercel

1. Import `jaxondoss/skill-trees` at vercel.com/new. Framework is detected as Next.js.
2. Environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Deploy. Open the URL, enter your email, tap the link. The first sign-in seeds your categories, skills, milestones, schedule, and rack.

## 3. Local development

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
pnpm typecheck
pnpm lint
pnpm build
```
