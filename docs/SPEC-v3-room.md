# FORGE spec v3: the room

Status: live in the app at `/` and `/room/<zone>` (2026-10-21) with real data and real logging; the v2 board
moved to `/board`. The owner's revision of 2026-10-21 (below) supersedes earlier text where they differ.
Prototype (source of truth for engine, ui and art): `docs/redesign/room-prototype/`; `node
scripts/room-sync.mjs` copies it into `public/room/`. Contract: `docs/redesign/room-prototype/CONTRACT.md`.
Camera maths: `engine/camera.js`, tested in `tests/unit/room-camera.test.ts`.

## 1. The idea
One 16-bit pixel-art diorama of Jaxon's college room, seen whole from eye level like a stage set. Effort
plates the obsidian statue in gold; every skill lives in one object; logging stays under 30 seconds.
Light is earned. Light order: statue gold > relic embers > skill outlines > decor. Window, sun patch and
statue gold are brightest; lamp pools, CRTs and LEDs are mid (radial <= 24 px); edges stay dark (vignette
on the outer 15%). Misses show as dust, never damage.

## 2. Camera
- Art core 960 x 540 (art-v3.js). Default view is the whole room, 1.3x closer than the old full view,
  horizon at about 42%. No mouse-look parallax anywhere: depth layers move only during the zoom dolly and
  the phone pan.
- Zoom into a zone fills the screen with about 1/3 of the room (focus boxes capped at 400 px wide). The
  dolly: 80 ms anticipation pull-back, push-in, the rest of the room dims by palette steps, the clicked
  object gets a spotlight pulse on landing, then its panel slides in. The zone title fades in within
  about 120 ms of the click. Clicking a Today goal never moves the camera (only the mote flies). After a
  log inside a zone the camera stays until Esc.
- Routing: `/` (or `/room`) is the whole room, `/room/<zone>` a zone; steps use history.pushState so Back
  walks out. Keys 1-7 step in, Esc steps out.

## 3. Perspective and look
- Original geometry idea (art/room/common/room.py), scaled to the new resolution: the side walls are raked
  flats that get bigger toward the viewer (left wall top y = 62 - 0.15(176 - x), bottom
  y = 198 + 0.19375(176 - x), mirrored on the right), so the room opens wide instead of narrowing.
- Look from the approved still (art/room-v2/build.py): honey-oak plank floor leading to the statue, warm
  wood panelled walls a shade darker, ceiling with wood beams, trailing pothos, a small skylight, pendant
  lamps, cables; no fan.
- Statue: about 10 ft obsidian figure on the back wall between the bookcase and the window, backlit with a
  clear rim light, same pose always. Gold plating by body section (tiers I..V: 0, 2, 4, 6, all 7
  sections; V eyes glow). Pedestal stone, marble, gilded by tier with a plaque showing only the tier name
  (for example "III · FORGED"). Clicking it zooms to the window area and turns on a ceiling downlight cone
  with dust motes.
- Tiers change three big things plus the light: II bed frame, string lights, desk lamp; III big rug, desk
  chair, framed posters; IV leather armchair, wood bookcase, plant wall; V neon FORGE sign, gilded pedestal,
  warm light everywhere.
- Every zone has an "it's on" light when the zone or its object opens (bedside lamp, reading lamp, desk
  lamp, monitor glow, gym light, kitchen pendant, statue downlight).
- Night: blinds up, slate night sky, lit shotgun-house windows, streetlights, streetcar headlight, cool
  moonlight in, warm lamps; completion sets how many lamps are on. The floor sun patch is hidden at night.
- Signs never carry invented words (symbols or blank lines), except FORGE, WELCOME, the pennant and the
  plaque. No Tulane crest, no IRONMAN M-dot.

## 4. Zones (keys 1-7), one object per skill, no overlaps
| Key | Zone | Skill objects | Features | Decor (art manifests) |
| --- | --- | --- | --- | --- |
| 1 | Kitchen and door | fruit basket (Food; bodyweight logs here), big leafy plant (Gut Health), door with flyer board (College Integration) | water jug growth piece, doormat (review letter), switchboard (Settings), LEFT relic mount | pendant, pothos, counter, kettle, microwave, spices, board, table, water, stool, hooks, shoes, clock, switch |
| 2 | Bed | bed with alarm clock (Sleep), floor cushion (Meditation), plasma globe (Visualization) | | string lights, frame, nightstand, sconce, poster, hamper, slippers, runner, shelf, charger |
| 3 | Library | bookshelf with reading chair and lamp (Reading), chess table (Chess) | lit trophy case + potion shelf of 15 bottles (archive) | pendant, pothos, armchair, potions, bookcase, poster, sign, stool, books on the floor, clock, globe, shelf plant |
| 4 | Window | statue (overall) | relic NICHE above the window, big CRT (Today), small CRT (stats) | skylight, ceiling and floor cables, rug, amp, plants, sill mug and books, vinyl, plant wall, power strip, downlight fixture |
| 5 | Study | desk with backpack, lamp, class corkboard (Academics; red sheet when due < 48 h), wall calendar + planner (Time Blocking) | course books (one per course, coloured spines), journal | pendant, pothos, desk, lamp, chair, backpack, pennant, photo frame, shelf, bin, headphones, mug |
| 6 | Computer | computer and monitors (AI Building), product whiteboard (Dropshipping) | money tree growth piece, sticky note (focus line) | desk, money tree, chair, speakers, router, cables, boxes, LED strip, headset, shelf, can |
| 7 | Gym | weight rack (Strength), shoes + medal wall + bib + mileage poster (Running), bike half under a tarp with the swim/bike/run emblem (Triathlon; tarp off when active) | RIGHT relic bracket | medals, tiles, kettlebell, bag, roller, bottle, rope, timer, trophies, mat, light, chalk |

130 art items: 27 hotspots, 88 decor, 7 shell, 8 overlays (`art/room-v3/*/manifest.json`).

## 4a. Skill glow
1 px warm-gold outline on the outer silhouette of every skill object, breathing 30%..70% over 2.5 s; a
3-frame shimmer (one bright pixel, then a 3x3 plus with a white centre and pastel arms, then four dim tips)
at 8-10 fps, once every 4-7 s per item with random offsets. Hover or focus: outline 100% plus one sparkle.
Done today: outline and sparkles off (the LED still shows done). Reduced motion: static outline only.

## 4b. Relics
Three mounts: left by the door, the niche above the window, the right bracket by the gym. An empty mount
shows a subtle pixel plus; clicking opens a pixel shop shelf of about 50 relics by category plus a custom
one (title, linked skill, a number target or comma-separated steps, optional deadline). An active relic
glows with embers (orange to deep red, uneven flicker, rising ember pixels, brighter at night) and is
forged dark iron (< 1/3), glowing hot, then cast gold at 100%. Achieved: anvil strike and hiss, then it
moves to the trophy case. Data: table `relics` (migration 0011, owner RLS, one active relic per slot).
Progress is computed on the server from the linked skill's metric against the target (src/lib/data/room.ts
RELIC_METRIC), a milestone, or the steps. Actions: `src/app/relic-actions.ts`.

## 5. Status in the world (D5)
LEDs drawn by the engine in true category colour: dark socket = no goal today, hollow = pending, half =
Floor, full = done, slow blink = never miss twice. Sky follows today's completion through four light LUTs
(0-24, 25-59, 60-84, 85+), switched with a Bayer dissolve so every frame stays in the 32 colours; night LUT
after 22:00. Alerts are props (backpack sheet, doormat letter). Labels only on request: hover or focus
shows a nameplate ("STRENGTH 52"); hold Shift (phone: magnifier) shows all. Always on screen: corner strip
(score, today %, streak), TODAY, mute, zone dots.

## 6. Today HUD and panels
Pixel window (right on laptop, bottom sheet on phone) with Rack, Balance, Stretch rows: tap logs the
planned tier, long-press or right-click opens tiers, swipe left or S swaps once, UNDO for 5 s. A log sends
a light mote to the object, lights its LED, pulses gold through the statue, tinks (pitch rises per
completion) and warms the sky; logging never waits on animation. Hotspots open a pixel panel (room dims):
skill panels have TODAY, STEPS, DATA, NOTES tabs; feature panels cover the statue and upgrade tree, stats,
archive, calendar, journal, review letter, settings and the focus note.

## 7. Palette (D3) and type
32 colours in `art/room/common/palette.json`, measured from the reference first. Corrections: #3E6B35 and
#7F9AA6 do not occur in the reference (kept as design colours); the sun is #FEF576; the sky has no purple,
so Mind's plum ramp (#724F5B, #AF4D61, #D98AA0) is new. Category ramps: Gold (you), Business amber,
School slate, Athletics CRT red, Nutrition leaf, Mind plum. Silkscreen for labels and numbers; VT323 for
body text in pixel windows.

## 8. Art pipeline
v3 art is drawn by Pixel Art Studio build scripts (`art/room-v3/<part>/build.py`: shell, left, back, right,
statue-relics), palette-locked by `art/room-v3/common/room.py`, merged by `art/room-v3/merge.py` into
`art-v3.js` (indexed, RLE), which fails on any off-palette pixel. Each part ran at least three see, critique, fix passes. Room tiers I-V swap decor
variants (bare bulb to brass dome, mattress on the floor to upholstered bed, folding desk to custom desk
with a neon FORGE sign); higher tiers replace items, never empty the room.

## 9. Decisions for Jaxon
- D1 screen fit and D2 statue scale (above).
- D6: the minutes slider and an LED "started" state need one nullable column, `plan_goals.progress_min`,
  or are deferred.
- D7: replaying events that happened while the app was closed uses a per-device record (no DB change).
- D8: "L/C mapping" read as Level/Consistency (stage from score, dust from neglect). Confirm.
- D9: room-tier losses only after 7 days below a threshold, with 2-point hysteresis, from score snapshots.
- D12: the sky is a completion meter, not a clock: a 9 AM sky stays dusky until goals are done.

## 10. In the app (2026-10-21)
- `/` and `/room/<zone>`: `src/app/(room)/layout.tsx` loads `loadRoomData()` (src/lib/data/room.ts, same
  shape as the prototype's data.js plus `live: true`) and renders `src/components/room/RoomClient.tsx`,
  which loads the classic scripts from `public/room/` in order and bridges the room's events to the server:
  log -> completeGoal, swap -> swapGoal, bodyweight and numbers -> addMetric, focus -> saveFocusLine,
  relic -> createRelic / updateRelicSteps / achieveRelic / abandonRelic. Fresh data is applied once no save
  is in flight; errors show as a pixel status line. The dock, field and pointer light stay off the room.
- `/board` keeps the v2 board; the dock has Room and Overview.
- Tests: `tests/e2e/room.spec.ts` (zones and URLs, Back, Today logging under 30 s to 100%, panels, Shift
  nameplates, relics). Next: panels for calendar, journal, archive and reviews on real data; photo frame
  from `public/room/user/wall-frame.png`; the optional 1.2x goal boost for a relic's linked skill.

## 11. Revision 3 (2026-10-21, live art)
- The live room art is now the Revision 3 room: `art/room-r3/build.py` draws every object into its own
  sprite under the existing item ids (all 130 kept, plus 13 new decor/overlay ids such as `centre.dog`,
  `window.candles`, `window.radiator`). World = master - (80, 96). Back wall master x 170..630, side walls
  are 14% slivers, vanishing point world (320, 116). Stills in `docs/redesign/room-r3/stills/` are
  composited from the same sprites in the engine's draw order, so they cannot drift.
- Pipeline: `python3 art/room-r3/build.py` (sprites to `room-prototype/art-r3/`, manifest, zones.json,
  palette.json) then `python3 art/room-v3/merge.py --src room-r3` (runs `art/room-r3/parity.py`, palette and
  grain checks, keeps the replaced bundle as `art-v3.prev.js` for rollback, writes `art-v3.js`), then
  `node scripts/room-sync.mjs`.
- Palette: the 32 v3 colours unchanged plus CHAR, WALL_G (plaster) and STAT_1, STAT_2, STAT_HI (obsidian).
- Style: flat 2-tone lamp pools (no dither), sky in 5 flat bands, 2x2 string-light bulbs, props one value
  step darker, every skill object has a 1 px lighter resting outline; each skill object sits in a lamp
  pool or the sun patch (door lamp, kitchen counter light, gym pendant added).
- Statue: broken cool rim on the window side only; 1 px gold kintsugi that grows by tier (I a seed at the
  chest, II-V more trunks, flakes at IV-V, glowing eyes at V); pedestal and plaque text by tier. The
  downlight is a flat two-tone cone with a floor pool that lifts the statue's lit side.
- Engine: Today CRT idles dim amber with a blinking cursor until the first log, then shows today's bar;
  the stats CRT alternates "72 OVR" and the streak with a flame; the plaque gets 5 tier pips and an
  in-tier bar; done LEDs are solid with a cream centre and a dark keyline; never-miss-twice blinks; only
  today's top-priority object pulses (never-miss-twice, Focus Rack pins, lowest score), and the Today list
  uses the same order. The dog sleeps in the sun patch or lies head-up by the most neglected object.
  Hotspot labels include today's state ("Strength, 52, done today"). Reduced motion: no mote or gold pulse.

## 12. Art pass 4 (2026-10-22, live art)
The approved R4 stills (`docs/redesign/room-r4/stills/`, brief: dorm room, sunset wash, satin floor) are now the live
room. `art/room-r4/build.py` paints the scene once per state and cuts every object out as its own sprite under the
existing item ids (all 143 R3 ids, targets and variant keys kept; parity in `art/room-r4/parity.py`).
- **Knight:** the obsidian figure is replaced by a 10 ft knight on a rune pedestal (`window.statue`, t1..t5): I iron,
  II gold seams and a faint visor, III gold trim, energy lines and a short cape, IV gold chest and helm with an emblem,
  V fully golden with a crest. The plaque shows the tier name only. The ceiling beam with floating dust is the
  downlight overlay; the close-up has one crop per tier. Tapestry with an original anvil-and-hammer emblem behind it.
- **No door:** College Integration (`kitchen.door`, same id and target) is the kitchen-wall corkboard of flyers,
  photos and tickets. The weekly review (`kitchen.doormat`) is the envelope on the counter (alert: flap up).
- **Chess in the window zone:** `library.chess` keeps its id and now sits in zone `window` (key 4), right of the
  media stand; `zones.json` skills map and focus boxes follow.
- **Moving lights** (decor items with anim frames, plus anim.night frames for the night): CRT flicker
  (`window.crt-flicker`), plasma tendrils and wall glow (`bed.globe-glow`), potion bubbles (`library.potions-bubbles`),
  desk-lamp dust at night (`study.lamp-dust`), green terminal scroll and cast (`computer.terminal`), red gym timer
  (`gym.timer-led`). The fridge crack glow on hover is LATER (the fridge is not a hotspot).
- **Light:** every sprite is baked at golden hour (R4 = identity). R1 dawn and R2 midday LUTs are derived from the
  lighting strip renders, R3 is late afternoon; completion still picks the ramp. Every sprite has a painted night twin
  (`<key>.night`, or `night`) that the engine draws without the NIGHT LUT, so night matches the strip.
- **Self-critique fixes:** bed and gym slivers stand further out from their walls, the bike is fully visible, midday
  has a sun patch and darker corners, night plaster stays plum-charcoal instead of navy. Light falloff bands use a
  1 px line dither (the grain check passes; objects step without dither).

## 13. Art pass 5 (2026-10-23)
Brief: the owner's art pass 5 prompt (dorm room). Built and live; see `docs/HANDOFF.md` (Art pass 5) for files.
- Lighting: warmer, stronger sunset wash; every halo a smooth gradient (no rings); the oval vignette has no
  visible edge. Implemented as an RGB overlay over the palette art (zones.json `views.<v>.light`).
- Window: larger window kept with both curtains; mountains behind the rooftops and trees; drifting clouds,
  birds now and then, the streetcar passing; the TV setup below stays.
- Camera: 15% closer (556x235 core), knight and window centred. Left view: bed and kitchen up close. Right view:
  the gym and both desks. A walk-forward-and-turn under a second; the opposite arrow returns to the centre.
  Pixel chevrons at the far left and right edges, always visible where a turn exists; arrow keys turn in the
  room view (in a zone they still walk the zones). No floor hotspots for navigation.
- Brought back: the tall dark bookcase (rolling ladder, plants spilling off the top; potions and trophy case
  beside it), two separate desks, more plants with a gentle sway and hanging plants, a darker ceiling.
- Zones: study desk with the corkboard, calendar, course books and backpack; dropshipping desk with a big
  whiteboard on the side wall, two green-code monitors and a black mesh chair; the gym moved about 10 ft right
  (only a hint in the main view) with race photos, a medal hanger, kettlebells, a chalk bucket, a rubber mat, a
  symbol poster, a gym bag and a sneaker shelf; meditation rug, cushion and candle in front of the window; a big
  8x8 chessboard on its own stand; a big rug under the bed.
