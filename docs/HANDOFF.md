# Session handoff (2026-10-23)

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

## Room revision 3 (2026-10-21)
- Live art is R3 (see `docs/SPEC-v3-room.md` section 11). Rebuild: `python3 art/room-r3/build.py`,
  `python3 art/room-v3/merge.py --src room-r3`, `node scripts/room-sync.mjs`. Rollback: copy
  `docs/redesign/room-prototype/art-v3.prev.js` over `art-v3.js` and re-run room-sync.
- Plan and review: `docs/redesign/room-r3/PLAN.md`, `REVIEW.md`. MUST list done; checks green (lint, tsc,
  vitest, test:db, merge, parity, e2e).
- Some v3 ids now hold different R3 props (e.g. `kitchen.microwave` is the fridge, `kitchen.table` the
  bleed shelf, `computer.speakers` the keyboard, `gym.timer` the mileage poster); each manifest note says
  what it is.
- LATER (from PLAN.md): sun position from the clock and lit house windows; day-complete flash; tier-up
  glide and permanent prop; growth-slot caps; morning grade; colour-blind backups beyond LEDs; data-driven
  calendar and charts (needs per-day history); streak break moment; long-press quick-log with UNDO;
  status strip of 15 bottles; statue regions per category; "?" sparkles and legend; dog zoomies and
  welcome-back screen; neglect escalation at day 3/7/14; sound set; daily quest and weekly chest; easter
  eggs. Also: the phone window zone frames the window and CRTs, so the statue needs a pan.

## Art pass 4 (2026-10-22, replaced by art pass 5)
- Live art is R4 (spec section 12; stills and `live-room@2x.png` in `docs/redesign/room-r4/stills/`).
  Rebuild: `python3 art/room-r4/build.py` (stills + layered export; `--live-only` / `--stills-only`),
  `python3 art/room-v3/merge.py --src room-r4` (parity vs `art-v3.r3.js`, palette and grain checks),
  `node scripts/room-sync.mjs`. Sprites: `docs/redesign/room-prototype/art-r4/`.
- Rollback to R3: copy `docs/redesign/room-prototype/art-v3.r3.js` over `art-v3.js`, run room-sync
  (R3 sprites still in `art-r3/`; `art-v3.prev.js` is the older v3 bundle).
- Engine: painted night twins skip the NIGHT LUT (`render.js`), `anim.night` frames, R4 colour names in the
  dust and brighter maps. e2e: chess is clicked from the window zone.
- Many R3 decor ids have no R4 prop and are 1 px placeholders (manifest notes say which ids hold which prop).
- LATER: room-tier decor art (t1..t5 keys alias the base art), stage art for the alarm clock, plasma globe,
  monitors, shoes and bike (s0..s2 alias base), fridge crack glow on hover, desk lamp on when Academics opens,
  hologram glitch on tier-up, the dog redrawn in R4 style (it is the R3 sprite re-indexed), lighting slider
  as a real time-of-day feature.

## Art pass 5 (2026-10-23, replaced by art pass 6)
- Three views: main (knight, window), left (bed, kitchen, entry door), right (study desk on the side wall,
  dropshipping desk, gym). Arrow keys or the pixel chevrons at the screen edges play a walk-forward-and-turn
  (~760 ms, `ROOM.turn`); a zone in another view (keys 1-7, a copy hotspot) turns straight into it.
- Art: `art/room-r5/build.py` (stills + layered export per view; `--stills-only` / `--live-only`), then
  `python3 art/room-v3/merge.py --src room-r5` (parity vs `art-v3.r3.js`, grain check) and
  `node scripts/room-sync.mjs`. Sprites in `docs/redesign/room-prototype/art-r5/<view>/`. Stills and the turn
  captures in `docs/redesign/room-r5/`. Rollback to R4: copy `art-v3.r4.js` over `art-v3.js`, run room-sync.
- Items carry `view`; objects seen in two views keep their canonical id in their zone's view and get a
  suffixed copy (-m, -l, -r) with the same target. zones.json has `views.<v>` (frame + smooth light) and each
  zone a `view`.
- Light: sprites are baked at one flat ramp level per object; the warm wash, every glow and the oval vignette
  are drawn by the engine with canvas gradients from `views.<v>.light` (render.js drawLight). This is the one
  place the frame leaves the palette. Lamp pools (glow.js) go through the same overlay.
- Window: mountains; clouds, birds and the streetcar are drift sprites (`drift` on the item, render.js).
- Default framing 15% closer: the core is 556x235 (was 640x270).
- LATER: the FORGE sign sits above the right view's frame; side-wall objects are drawn per view, so small
  differences between views exist; plant sway runs at 2 fps (art frames); stage art still missing for the
  same items as pass 4.

## Art pass 6, v3.4 phase 1 (2026-10-27, live)
- One square room (28 x 28 ft, ceiling 13.5 ft) seen from its centre: four 90 degree views, front (window,
  knight, library), right (study desk, dropship desk, gym), back (calendar wall, an empty shell until phase 3),
  left (kitchen, entry, bed). Corner pieces (fig, brass lamp, two snake plants), beams, strings and hanging
  plants are world geometry drawn the same in every view. Each master (800x560) carries 10 degrees of its
  neighbours in its margins, re-projected exactly (one camera centre).
- Turning is a pan (`ROOM.turn(dir)`, `ROOM.turnTo(view)`): each frame re-projects the columns of the views'
  full masters; 90 degrees in 640 ms, 180 in 900 ms. Arrows and chevrons cycle front, right, back, left. URLs:
  `/room` (front), `/room/right`, `/room/back`, `/room/left`; zones keep `/room/<zone>`.
- Albedo-only art plus a material ID per pixel (`<sprite>.mat.png`, bundle `images[path].mat`). The WebGL2
  compositor (`engine/gl.js`, `engine/light.js`; LIGHTING_SPEC phases 1 to 8) lights it from the aux buffer
  render.js fills (depth, flags, material). The sun follows the real clock (New Orleans); weather cover dims
  the sun; completion drives key, saturation and warmth. GPU tiers: `?gltier=ultra|high|medium|low`, auto by
  default; `?gl=off` or no WebGL2 uses the v3.3 LUT ramps and Canvas2D light. Demo flags: `?t=21:30`,
  `?el=4` (sun elevation), `?p=0..100`, `?light=albedo|light|refl|...`.
- Live weather (`engine/weather.js`, free Open-Meteo, every 15 min): rain, beads and runs on the glass,
  snow, fog, storm flashes (safe rates). `?weather=rain&precip=6&wind=12` for demos. Before a paid release the
  free API (non-commercial) needs a commercial plan or another provider.
- Textures (`art/room-r6/textures.py`, TEXTURE_SPEC steps 0 to 9) and the texture gate
  (`art/room-r6/texture_check.py`, run by merge.py, replaces the grain check). Palette: 64 colours, the 27 new
  ones in `docs/redesign/room-r6/stills/palette-ramps@4x.png` and `swatches@4x.png` for review.
- Build: `python3 art/room-r6/build.py` (~5 min; `--preview` for quick stills), then
  `python3 art/room-v3/merge.py --src room-r6` and `node scripts/room-sync.mjs`. Deliverables:
  `node scripts/room-r6-deliverables.mjs [stills|passes|turn|fps]`. Rollback to R5: copy `art-v3.r5.js` over
  `art-v3.js` and run room-sync (the engine reads both).
- Notes: `docs/redesign/room-r6/` INTERFACES.md, GL_NOTES.md, TEXTURE_NOTES.md, WEATHER_NOTES.md.
- Phase 2 (statue level and turn audit):
  - The plaque on the knight's pedestal reads "40 [bar] 41": progress from the statue level to the next, in
    gold ramp steps, flagged emissive for the light model (`engine/statue.js`). The bar follows the overall
    score both ways; the level is stored (`profiles.statue_level`, migration 0012, trigger: it never drops for
    a signed-in user) and set to the score's whole part on the first load.
  - At 100% UPGRADE appears on the plaque and pulses; a real button covers it (44 px, keyboard, named "Upgrade
    the statue to level N"). Pressing it raises the level by one (`upgradeStatue` checks the score on the
    server). The moment: a gold band climbs the knight and pedestal, the plaque drains and engraves the new
    level; at 20, 40, 60, 80 the armour changes under the band and the bell rings. Reduced motion: instant.
  - The knight's armour (room tier) follows the level's tier, not the raw score. Demo flags: `?score=`,
    `?level=`.
  - Turns: the pan starts from the real rest frame and settles into the destination's rest frame (no pop from
    frame-wide light effects), and adjacent views cross-fade over 10 degrees at each corner.
    `node scripts/room-turn-audit.mjs` measures all eight turns at golden hour and night.
- Phase 3 (the calendar wall, back view):
  - Art: the same plum plaster and floor; a painter's studio in a few props (paint cans and brush jars on a
    stool, a splattered drop cloth, canvases leaning in the corner, an olive tree); four black industrial dome
    pendants, the strongest light in the room, throw warm pools down the wall; a framed month board and a tall
    day bar whose fields the engine fills (`zones.json views.back.calendar`).
  - `engine/calendar.js`: month title with today's date, what is on now and when the next event starts; the 6 x 7
    grid (past days by FORGE completion: dark red at 0% to light green at 85%, gold fill and outline at 85%+;
    future days greyed; today a cyan wireframe with a pulsing marker); each day's Google events the way Google
    shows them (all-day bars, then timed events with a dot and start time, "+N"); the day bar with the selected
    day's completion and what was logged, and its events on a 6 AM to 3 AM scale with a moving now line.
    Google colours are drawn as the nearest palette colour. In the calendar zone (key 8) every day is a button,
    the arrows change month, ADD opens Google Calendar on that day.
  - Data: `ROOM.data.calendarWall` (src/lib/data/calendarWall.ts), other months from `GET /api/calendar?month=`.
  - Google Calendar: OAuth in Settings (`/api/google/connect`), read-only, all calendars, Google colours
    (`src/integrations/googleCalendar.ts`, setup in `docs/redesign/room-r6/GOOGLE_CALENDAR.md`). Needs
    GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel (and INTEGRATIONS_KEY, already set).
  - Time Blocking is retired: migration 0013 archives it (final score from its last snapshot, history kept) and
    unpins it; the study desk's wall calendar is decor that leads to the calendar wall.

## Room v3.5 (2026-11-08, branch v35/int)
What changed (one navigator, skill view, overview, wire marks):
- Motion: every camera change goes through `ROOM.nav` (engine/nav.js): places wall / zone / overview / skill, moves made
  of legs (TURN, DOLLY, RISE, DESCEND camera legs drawn from pre-lit shots; LIFT, DROP, SWAP live legs). Pixel stipple
  (Bayer) dissolves, integer zoom at rest, interruptions reverse in place. Audit: docs/redesign/room-r6/MOTION_AUDIT.md.
- Skill view (engine/skill.js): clicking an item never moves the camera; the item lifts out in whole-pixel zoom steps and
  floats lit to the left of the board (board always right on laptops, 58 % bottom sheet on phones). Reading is an
  authored floating book stack (3/5/7 books by stage); other items use isolate re-exports. One SELECT light tinted
  toward the key colour, the room dims to ~40 %, a dithered darkening (x0.3 at the centre) and pool sit behind the hero,
  bloom drops to x0.25 while it is out. The room item keeps a dashed gold socket. kitchen.gut hero runs at heroGain 0.5.
- Overview (engine/overview.js, art/room-r6/overview.py): Up from a wall or zone (or from the skill view) rises to a
  lid-off diorama; click / tap (nearest centre) / list row opens that item's skill view on its wall; Down or Esc returns.
  Practicals x0.6 at night there (lighting.nightGain). Zone dots hidden in the overview.
- Wire marks (engine/wire.js): every active skill carries a 1 px gold wire one pixel outside its hull with 4 corner
  nodes, coloured by state (GOLD_MID idle, GOLD open goal, GOLD_HI logged, breathing for the top priority, slate when
  neglected), with a 1 px INK outer keyline (>= 3:1 on every wall). Hover / focus / Shift shows the 3D cage (or the hot
  wire for chess, cushion, gut, bookshelf). Marks never drop below 70 % of their palette colour at night (both paths) and
  take almost no bloom.
- Removed: the old skill glow/shimmer (glow.drawSkillGlow) and the feature hover ring (wire.js replaces both).
Defaults: world-res bloom ON (`ROOM.gl.gains.worldBloom = 1`; 0 restores the old bloom; stills differ ~2/255 and only
world bloom passes the zone/wall framing check). Reduced motion: every move instant, marks static.
How to test: `node scripts/room-sync.mjs`, then npx eslint, npm run typecheck, npx vitest run, npm run test:db, the e2e
specs tests/e2e/room.spec.ts, room-skill.spec.ts, room-overview.spec.ts, room-wire.spec.ts (phone viewport). Visual and
numeric harnesses (headless Chromium, SwiftShader): scripts/room-motion-audit.mjs, scripts/room-v35-light.mjs
(stills | framing | crisp | hero), room-v35-skill.mjs (stills | lift | ac), room-v35-wire.mjs ac, room-v35-overview.mjs
(stills | crisp | light | rise; TOP_LIGHT='{...}' overrides the overview lighting for tuning). Art: `python3
art/room-r6/build.py` then `python3 art/room-v3/merge.py --src room-r6` (gates incl. overview_check) then room-sync.
Known: overview item-wise hue gap vs walls stays ~24 deg by day (the frame hue shift is 2.5 deg; per-item hit rects mix
in floor), night overview frame luma +18 % vs the front wall; RISE contact sheets from readFrame can show stale frames
(live screenshots are smooth).

## Room skill hologram (2026-11-11, from the approved gym mockup)
- engine/holo.js + ui/holo.css: a single click / Enter on a skill object is a skill place with `holo: true`; skill.js
  lifts the hero to the centre column (`layout({centre})`, small objects up to 5x room zoom) and calls
  `ROOM.holo.show` instead of opening the board. Three nodes per skill (graph with DAY/WEEK, a skill visual, Today's
  tier checks via `ROOM.uiToday.setResult`), tethered; the computer shows ai-building left, dropshipping right.
  Double-click / Shift+Enter / OPEN SKILL / double-click on the lifted object: `ROOM.nav.toBoard()` (same URL, no
  new history entry). Esc, a click on the room, Back close. `ROOM.holo.busy()` (pull-up 1.2 s, the 240 ms
  double-click wait) feeds `ROOM.nav.busy`. Features keep the skill view.
- Data: `skills[].log28` (tier rank per day, room.ts and room-proto-data.ts); strength uses `window.ROOM_LYFTA` or
  `ROOM.data.lyfta` (src/lib/data/lyftaSummary.ts; the app fetches it when LYFTA_API_KEY is set). The prototype's
  docs/redesign/room-prototype/lyfta.js is the owner's real workouts (`NODE_USE_ENV_PROXY=1 node
  scripts/room-lyfta-snapshot.mjs`): prototype pages and artifacts only, never public/room. Assumed: day boundary
  America/Los_Angeles, 4 planned lifts a week.
- Tests: tests/e2e/room-holo.spec.ts, tests/unit/room-holo.test.ts.

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
