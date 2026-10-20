# Room prototype contract (frozen for parallel work)

FORGE v3: one 16-bit pixel-art diorama of Jaxon's college room (mood and palette of
`docs/references/sunset-room.jpg`: dark room, one warm sun through a big window, slate city, CRTs, plants,
terracotta tiles with a hot reflection, red LEDs; about 85% of the frame dark; light is scarce and earned).
The prototype is static: `index.html` + classic scripts on globals, no build step, works from `file://`.

## Sources of truth
- `art/room/common/palette.json`: 32 colours by name, 6 category ramps (dark, mid, light), lighting LUTs.
- `art/room/common/zones.json`: world frame, 7 zones (id, key, name, focus box, phone stop, territory),
  shell geometry, centre placements, layer bands, skill-to-zone map.
- `art/room/common/room.py`: helpers for art build scripts (palette-locked `spr()`, geometry, `save()`,
  `item()`, `finish()`).
- `scripts/room-art.py` merges `art/room/*/manifest.json` into `docs/redesign/room-prototype/art.js`
  (`window.ROOM_ART = {palette, zones, items, images}`; images are palette indices, RLE base64,
  255 = transparent; decode: pairs of [count, index]).
- `scripts/room-proto-data.ts` writes `data.js` (`window.ROOM_DATA = {sample, fresh}`): real seed skills,
  goals and steps; scores from the real engine; SAMPLE history.

## World and layers
World coordinates: core x 0..640, y 0..270; painted art x -80..720, y -96..384 (800 x 480). Horizon y 121,
vanishing point (320, 121). Back wall x 176..464, y 62..198. Window x 284..368, y 70..152, sill to y 157.
Side walls are raked flats: left wall top y = 62 - 0.15(176 - x), bottom y = 198 + 0.19375(176 - x);
right wall mirrors about x = 320. Floor below y 198 between the wall bottoms; ceiling above y 62.

Layers 0..6 (parallax px at full deflection = index): L0 sky/sun; L1 outside city; L2 back wall and what
is on it, floor contact y < 210, bed, computer desk; L3 contact 210..222 (door, corkboard, chess table,
cushion, dog); L4 contact 222..236 (fridge, statue, rug, dumbbell rack, bench); L5 contact >= 236 (covered
bike, front floor); L6 frame crops at the screen edges. Draw order: layer, then contact y, then item order.

## Item format (manifest)
`{id, zone, kind: hotspot|decor|shell|overlay, layer, x, y, variants: {base|s0|s1|s2|dust|night|t1..t5|
alert|spring|summer|fall|winter|mardi-gras|jazz-fest|halloween|december|awake: "art/....png"},
target?: {skill}|{feature}, label?, led?: [x,y], hit?: [x,y,w,h], anim?: {frames, fps}, note}`.
Variant choice (engine): hotspot stage s0/s1/s2 from the skill's display score (0-33, 34-66, 67-100);
"night" when night; "t<tier>" for room tier decor (fall back to base); season/holiday variants for
overlays only when active; "alert" when the alert is on (backpack sheet, doormat letter); "awake" for the
triathlon bike when the skill is active. Hit box defaults to the sprite's opaque bounds.

## What the engine draws (art never does)
LED sockets at `led` (3x3, after the lighting LUT, in true colour): off = dark socket (no goal today),
hollow ring = goal pending, half = Floor, full = done (category light shade), slow blink = never miss
twice. Dust: speckles of BROWN_2/ROSE_0 on the top edges of a neglected skill's object, plus one step
darker. Hover/focus outline (1 px, category light shade), nameplates (pixel font, "STRENGTH 52"), zone
title, motes, statue gold pulse (palette cycle GOLD_DK > GOLD > SUN on the statue's GOLD pixels).

## Lighting
Art is painted in the golden state. Today's completion picks a LUT: R1 0-24%, R2 25-59%, R3 60-84%,
R4 85%+ (identity). NIGHT after 22:00. DIM under an open panel. Switch between LUTs with a 4x4 Bayer
dissolve anchored to world coordinates, so every frame stays inside the 32 colours.

## Art rules (Pixel Art Studio)
Read `/home/user/skill-pack/.claude/skills/pixel-art-studio/SKILL.md` and its references (patterns,
techniques, validations, sharp_edges). Master palette only (spr() enforces it); hard edges, no
anti-aliasing, alpha 0/255 only, no dithering except deliberate Bayer texture. Light: one warm key light
from the window (centre), a 1 px RIM/ORANGE edge on window-facing sides (left-wall objects lit on their
right side, right-wall objects on their left side, back-wall objects on top edges), small local glows
around screens and LEDs, cool SLATE only outside. Keep about 85% of the room dark (BROWN/INK/TERRA_0).
Density like the reference: every surface used, stacked gear, cables, plants of mixed sizes, posters,
boxes; decor outnumbers hotspots about 3 to 1; hotspot objects are never brighter or louder than the decor
around them (screens excepted). Follow the see, critique, fix loop: render a preview of your whole part in
place (composite over the shell PNGs if present) at 4x, look at it, fix, at least 2 passes.

Room tier variants: an item may provide t1..t5; the engine shows the highest tN <= current room tier,
else base. Every zone gives at least 2 decor items tier variants (at least t1, t3, t5), following the
upgrade direction: I Raw (half-unpacked boxes, mattress on the floor, bare bulb, laundry, folding desk),
II Awakened (bed frame, string lights, desk lamp, first framed poster), III Forged (rug, proper chair,
framed posters, more plants, tidy cables), IV Ascendant (record player and vinyl, wood bookcase, leather
chair, plant wall), V Sovereign (neon FORGE sign, custom desk, trophy case, gilded plinth, statement art,
warm accent lights). Higher tiers replace items, never empty the room.

## Files and owners (never edit a file you do not own)
| Owner | Files |
| --- | --- |
| lead | CONTRACT.md, data.js, art.js (generated), art/room/common/*, scripts/room-art.py, scripts/room-proto-data.ts |
| engine agent | index.html, engine/*.js, styles.css, test-fixture-art.js, tests/unit/room-camera.test.ts |
| ui agent | ui/*.js, ui/ui.css |
| art agents | art/room/<part>/** and docs/redesign/room-prototype/art/<part>/** only |

## JavaScript API (engine provides, ui consumes)
index.html loads, in order: data.js, art.js (or test-fixture-art.js when art.js is absent),
engine/core.js, engine/camera.js, engine/decode.js, engine/render.js, engine/overlay.js, engine/input.js,
engine/fx.js, ui/sound.js, ui/strip.js, ui/today.js, ui/panel.js, ui/drawer.js, ui/help.js, engine/main.js.
`ui/ui.css` is linked after `styles.css`. Every file is a classic script that attaches to `window.ROOM`.

- `ROOM.data` (current state object: ROOM_DATA.sample or .fresh, mutable), `ROOM.art` (ROOM_ART).
- `ROOM.state` = { zone: null|id, night, season, holiday, roomTier, reducedMotion, muted, inspect,
  panel: null|itemId, todayOpen, photo }.
- `ROOM.on(name, fn)` / `ROOM.emit(name, detail)`. Events: "zone" {zone}, "hotspot" {item}
  (activated), "state" {}, "data" {}, "log" {goalId, result}.
- `ROOM.go(zoneId|null, {push=true})` steps in/out (dolly); `ROOM.setDim(bool)`; `ROOM.invalidate()`.
- `ROOM.itemRectCss(itemId)` -> DOMRect-like box of an item on screen (null if off-view).
- `ROOM.mote(fromCssPoint, itemId)` -> Promise (light mote to the object, then object to statue);
  `ROOM.pulseStatue(gain)`; `ROOM.skillOf(item)`; `ROOM.itemsForSkill(slug)`.
- `ROOM.ui.open(itemId)` (panel), `ROOM.ui.toggleToday(open?)`, `ROOM.ui.toggleDrawer()`,
  `ROOM.ui.toggleHelp()`, `ROOM.sound.tink(n)`, `ROOM.sound.pour()`.
- The engine owns the canvas, hotspot buttons, nameplates, inspect mode, zone dots, zone title, keyboard
  (1-7, arrows, Enter, Esc, Tab, Shift hold, T, P, ?, D for drawer) and routing (`#/room`, `#/room/<zone>`).
  The ui agent owns: corner strip (score, today %, streak), TODAY button, mute, phone magnifier button,
  Today HUD, pixel panel, demo drawer, help sheet, sound.
