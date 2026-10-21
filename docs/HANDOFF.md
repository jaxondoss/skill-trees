# Session handoff (2026-10-21)

Read this first in a new session. Repos: `jaxondoss/skill-trees` (the FORGE app) and `jaxondoss/skill-pack`
(skills). Work on branch `claude/confident-curie-o7oqeb`, then fast-forward `main` (`git push origin
claude/confident-curie-o7oqeb:main`). Main deploys to Vercel (skill-trees-seven.vercel.app); Supabase
migrations auto-run on main. Commits: `-c user.name="Claude" -c user.email="noreply@anthropic.com"`,
end with the Co-Authored-By and Claude-Session lines. No PRs unless asked.

## Rules Jaxon set
No em dashes in UI copy. No push notifications. 4 AM America/Chicago day boundary. 44 px tap targets.
Logging under 30 s. Direct copy, no hype or guilt. Secrets only in Vercel env vars, never in chat.
Never invent third-party API endpoints. Talk to Jaxon simply. He is near his weekly usage limit: be token
efficient (Haiku/Gemini for grunt work, Claude for thinking).

## App state (live on main)
- No login: proxy signs in the owner with FORGE_OWNER_EMAIL / FORGE_OWNER_PASSWORD; no onboarding.
- The v3 room is the home screen: `/` and `/room/<zone>` (real data, real logging, relics). The v2 board
  (statue, Today, skills, calendar) moved to `/board`. Skill pages `/s/[slug]`, `/c/[slug]`, `/overall`,
  `/review`, `/settings` (with a Connection check of env keys and Test Gemini).
- AI: Gemini first (`src/lib/gemini.ts`, model chain gemini-3.5-flash, flash-latest, flash-lite-latest),
  Claude backup (`src/lib/ai.ts`). Gemini key works on the free tier; image generation needs billing.
- Integrations: Chess (username), Lyfta (`src/integrations/lyfta.ts`, LYFTA_API_KEY, not yet confirmed
  live: Jaxon should tap Settings > Connect Lyfta). Strava, Canvas, Google Calendar pending.
  Apple Health via iPhone Shortcut planned, not built.
- Migration 0010 renamed lifta to lyfta and added strava/gemini providers.

## v3 room
- Spec: `docs/SPEC-v3-room.md` (owner revision of 2026-10-21 included). Prototype and source of truth for
  the room code: `docs/redesign/room-prototype/` (engine/*.js, ui/*.js, art-v3.js). After changing it run
  `node scripts/room-sync.mjs` (copies into `public/room/`) and commit both.
- App wiring: `src/app/(room)/layout.tsx` + `src/lib/data/room.ts` (ROOM_DATA from real rows) +
  `src/components/room/RoomClient.tsx` (loads the scripts, bridges events to server actions).
  Relics: migration `0011_relics.sql`, `src/app/relic-actions.ts`.
- Art v3: `art/room-v3/<part>/build.py` (shell, left, back, right, statue-relics), `common/make_zones.py`,
  then `python3 art/room-v3/merge.py` (writes art-v3.js, palette-checked).
- Tests: `tests/unit/room-camera.test.ts`, `tests/e2e/room.spec.ts`; existing e2e specs use `/board`.
- Not done yet: real-data panels for calendar, journal, archive and reviews (they still show prototype
  content), the wall photo frame, the optional relic goal boost.

## skill-pack
Added (skills in `.claude/skills/`, sources in `vendor/`): superpowers (minus using-superpowers and its
hook), karpathy-guidelines, 9 Trail of Bits security skills, pixel-art-studio (scripts at
`/home/user/skill-pack/.claude/skills/pixel-art-studio/scripts`). Superdesign vendored but inactive
(uploads code to its service). effortless (HeyCubit) vendored for reference; installed only in this
session's container (user scope), so it is gone after reload unless enabled in skill-pack
`.claude/settings.json` (needs Jaxon's approval) or installed on his own machine.
Playwright needs no key; `npm install -g @playwright/cli` belongs in the environment setup script.

## Open items for Jaxon
Strava keys; confirm Lyfta in Settings; Supabase Site URL `https://skill-trees-seven.vercel.app`;
ANTHROPIC_API_KEY optional; INTEGRATIONS_KEY for Strava/Canvas tokens.
