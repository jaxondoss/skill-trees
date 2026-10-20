# Session handoff (2026-10-20)

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
- v2 board at `/` (statue, Today, skills, calendar). Skill pages `/s/[slug]`, `/c/[slug]`, `/overall`,
  `/review`, `/settings` (with a Connection check of env keys and Test Gemini).
- AI: Gemini first (`src/lib/gemini.ts`, model chain gemini-3.5-flash, flash-latest, flash-lite-latest),
  Claude backup (`src/lib/ai.ts`). Gemini key works on the free tier; image generation needs billing.
- Integrations: Chess (username), Lyfta (`src/integrations/lyfta.ts`, LYFTA_API_KEY, not yet confirmed
  live: Jaxon should tap Settings > Connect Lyfta). Strava, Canvas, Google Calendar pending.
  Apple Health via iPhone Shortcut planned, not built.
- Migration 0010 renamed lifta to lyfta and added strava/gemini providers.

## v3 room (the redesign in progress)
- Spec: `docs/SPEC-v3-room.md`. Prototype: `docs/redesign/room-prototype/` (static; published privately at
  https://claude.ai/artifact/NRLtZL8cvWjNu2RFkJ8taj). Contract and ownership: its `CONTRACT.md`.
- Art: Pixel Art Studio build scripts in `art/room/<part>/build.py` (parts: shell, left, back-left,
  right-back, centre-gym), shared `art/room/common/{palette.json,zones.json,room.py}`. Rebuild: run each
  build.py, then `python3 scripts/room-art.py` (writes art.js). Data: `pnpm exec tsx scripts/room-proto-data.ts`.
- Camera maths tests: `tests/unit/room-camera.test.ts` (28 pass).
- Phase 1 done. Waiting on Jaxon's review of the spec decisions (screen fit, statue at 3/5 scale, palette,
  LED states, `plan_goals.progress_min`, L/C mapping meaning, sky as completion meter). Phases 2-7 build
  the room into the app; v2 stays live until the room covers every v2 feature.
- Known nit: the statue's close-up overlay was hidden from the room by a filter in `engine/core.js`.

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
