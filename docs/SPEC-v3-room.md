# FORGE spec v3: the room

Status: phase 1 delivered (this spec + clickable prototype). Supersedes v2 sections 3, 4, 8, 9, 10 once built.
Prototype: `docs/redesign/room-prototype/` (open `index.html` via any static server; `?state=fresh` shows a
new account). Contract and file ownership: `docs/redesign/room-prototype/CONTRACT.md`. Design maths:
camera, layers and rendering as recorded in the contract and `engine/camera.js` (unit-tested in
`tests/unit/room-camera.test.ts`).

## 1. The idea
One 16-bit pixel-art diorama of Jaxon's college room, seen whole from eye level like a stage set. Effort
fills the obsidian statue with gold; every skill lives in one object; logging stays under 30 seconds.
Light is earned: the sun, the statue's gold and lit LEDs are the brightest things on screen. Misses show as
dust, never damage. Reference: `docs/references/sunset-room.jpg` (measured 1129 x 2000, 84% of pixels
below 35% luma; we keep about that darkness).

## 2. Camera and screen fit (decision D1)
- Integer scaling in device pixels. Art is 800 x 480 around the 640 x 270 core, so every laptop shows all
  seven zones with no black bars. Room mode when an art pixel is at least 1.5 CSS px, otherwise pan mode.
- Jaxon's browser (1440 x 702 @2x): scale 4, 720 x 351 visible. 1920 x 950 @1x: scale 3. iPhone
  390 x 844 @3x: scale 9, 130 x 281 window, swipe to pan with momentum and soft snap to zone stops.
- Horizon at 45% of the visible window. Zone step-in is an integer zoom (2x on laptop), a 450 ms dolly
  pivoting on the zone (near layers grow faster and leave first), landing exactly on the integer scale.
- Parallax: horizontal only, 0 px (sky) to 6 px (frame crops), snapped to whole pixels. Reduced motion:
  cuts, no parallax.

## 3. Composition and layers
Back wall: library (left), window (centre), study desk (right). Left wall: bed (back), door and kitchen
(front). Right wall: computer (back), gym (front). Statue on a plinth and rug forward-left of centre, dog
in the sunbeam, ceiling fan, pendants, AC unit, conduit. Seven depth bands L0 sky ... L6 frame crops; an
object takes the band of the floor row it stands on (see contract). Decision D2: the statue is about 3/5
scale (81 px with plinth), because a life-size figure at eye level would be 120 to 140 px and cover the
window; tiers also read through veins, halo, plinth and the panel close-up.

## 4. Zones and hotspots (keys 1-7, left to right)
| Key | Zone | Hotspots |
| --- | --- | --- |
| 1 | Kitchen and door | fridge + hot plate + kettle (Food), door corkboard (College Integration), doormat (review letter), switchboard (Settings) |
| 2 | Bed | bed (Sleep), scale (bodyweight) |
| 3 | Library | bookshelf (Reading), chess table (Chess), floor cushion (Meditation), potion shelf (archive, 15 bottles) |
| 4 | Window | sill plants (Gut Health), vision board (Visualization), big CRT (Today), small CRT (stats) |
| 5 | Study desk | backpack (Academics, red sheet when something is due within 48 h), wall calendar (Time Blocking + completion calendar), notebook (journal); pennant and photo frame are decor |
| 6 | Computer | main monitor (AI Building), second monitor (Dropshipping), sticky note (focus line) |
| 7 | Gym | dumbbell rack + bench (Strength), shoes + bib (Running), covered bike (Triathlon, dormant) |
| 0 | Full room | statue (overall, tiers, upgrade tree) |

Each zone has at least 10 named decor props; the full inventory (153 items) is in the manifests
`art/room/*/manifest.json` (field `note`). Every hotspot object has stages s0/s1/s2 (scores 0-33, 34-66,
67-100) and engine-drawn dust when neglected 7+ days.

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
Art is drawn by Pixel Art Studio build scripts (`art/room/<part>/build.py`), palette-locked by
`art/room/common/room.py`, merged by `scripts/room-art.py` into `art.js` (indexed, RLE), which fails on any
off-palette pixel. Each part ran at least three see, critique, fix passes. Room tiers I-V swap decor
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

## 10. Phases after review (each ends green; v2 stays live until the room covers every feature)
2. Art polish and assets in `public/room/`, palette check in CI. 3. Engine in the app: `src/components/room/`,
`/room/[[...zone]]` with shallow routing. 4. Today HUD wired to the real actions (keeping `#today`,
"Complete:"/"Undo:", "Jump to today's goals"). 5. Panels on the real skill pages, calendar, journal,
archive, reviews. 6. Stages, tiers, night, seasons, holidays, dog, photo mode, sound. 7. Cutover: `/`
renders the room, v2 board retired, e2e suite migrated.
