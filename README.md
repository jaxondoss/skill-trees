# FORGE

A personal skill-tree progress app: five categories, fifteen skills, honest scores, and a daily loop that takes under 30 seconds. Built for one user first, architected for many (every table is owner-only under Row Level Security).

"FORGE" is a working title, set in `src/lib/brand.ts`.

## Stack

Next.js 16 (App Router, Cache Components) with TypeScript strict, Tailwind 4, Supabase (Auth, Postgres, RLS), Vitest.

## Layout

| Path | What |
|---|---|
| `src/app` | Routes: dashboard, login, auth callback |
| `src/engine` | Scoring, goal, and completion engines. Pure TypeScript, no I/O, unit tested |
| `src/seed` | Starting content (spec Section 12) seeded per user on first sign-in |
| `src/lib/supabase` | Browser, server, and proxy clients |
| `supabase/migrations` | Schema, RLS policies, rack lock trigger, `seed_user` |
| `tests/db` | RLS tests run against a local Postgres |

Setup and deploy: [docs/SETUP.md](docs/SETUP.md).
