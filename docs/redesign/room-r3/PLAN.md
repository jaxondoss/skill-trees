# FORGE room R3: implementation plan

Goal: replace the live v3 art (`art/room-v3/*` → `room-prototype/art-v3.js` → `public/room/art.js`) with the Revision 3 room drawn by `art/room-r3/build.py`.

Constraints:
- Keep every item id, hotspot target, LED, variant key and relic slot that the engine and `RoomClient.tsx` use.
- Style: chunky, flat 16-bit with no grain. The `merge.py` grain check stays on.

Coordinates: the R3 master (800x480) is the same frame as the v3 art (x -80..720, y -96..384). **World = master - (80, 96).** Only the geometry moves: the back wall widens to world x 90..550, the window and statue shift, and the side walls become 14% slivers.

## Baseline the build must keep (parity)
- 130 items: 27 hotspots, about 90 decor, 7 shell, 7 overlays. 7 zones: kitchen, bed, library, window, study, computer, gym.
- Hotspots with their ids and targets. For example, `library.bookshelf` → reading, `window.today` → today, and `window.statue` → overall (t1..t5).
- Relic slots: `kitchen.relic`, `window.relic`, `gym.relic`, with variants base / active / gold / hot. `zones.relics` maps them.
- Overlays: `window.statue-downlight`, `window.statue-closeup` (t1..t5), and the `<zone>.on` overlays.
- Variant keys per item: base / s0 / s1 / s2 / night / t1..t5 / g0..g3 / alert / awake / active / gold / hot.
- Zone `zones.json` keys: `core`, `horizon`, `vp`, `camera`, `zones[].focus`, the phone stops, `shell`, `centre` (statue, statueContactY, rug, downlight, dogSleep), `relics`, `layers`, `skills`.

## MUST (tonight, one build pass)

### A. Pipeline: turn the R3 still into a sliced art part
1. Refactor `art/room-r3/build.py` so it emits a `manifest.json` under `art/room-r3/`, without forking geometry.
   - Wrap each draw call in `with item(id, kind, layer, contact_y)`. This draws into a transparent 800x480 buffer, crops to the bounding box, saves `art/room-r3/out/<id>/<variant>.png`, and records x, y, led, hit and target in world coordinates.
   - The stills are still produced by compositing the same buffers, so stills and live art cannot drift.
2. The shell (sky, outside, wall/ceiling/floor bands l2..l5, window) becomes the 7 `shell.*` items.
   - String lights, pendants, the skylight, cables, rug and crop layers map onto the existing decor ids.
   - New R3-only props become new decor ids. Never rename an existing id.
3. Variants:
   - `night`: one per-sprite night LUT (the moon window gets its own art).
   - `s0/s1/s2`: deltas on each skill object (s0 bare, s1 = base, s2 adds an accessory or extra pieces). The bike also needs `awake`, and the doormat and academics need `alert`.
   - `t1..t5` and `g0..g3`: port the v3 recipes (boxes, mattress, bare bulb, up to neon sign and gilded plinth) on the R3 geometry.
   - Relics: draw a base / active / gold / hot set per slot.
4. Write `art/room-r3/zones.json`.
   - Derive it with `make_zones.py` from the R3 constants: back wall, window, sill, VP (400, 212) master = (320, 116) world, horizon, focus boxes (keeping 15 to 20% neighbour overlap), phone stops (default centred on statue + window + CRTs), and centre (statue box, contact y, rug, downlight anchor, dogSleep in the sun patch).
   - The skill-to-zone map is unchanged.
5. `merge.py`: add `PARTS_DIR` / `--src room-r3` and point the output at `art-v3.js`. Then run `scripts/room-sync.mjs` → `public/room/art.js`.
6. New parity check (`art/room-r3/parity.py`). It compares against the current `art-v3.js` and fails on:
   - a missing id;
   - a changed target;
   - a missing variant key;
   - a hotspot without a LED, or with a LED outside its sprite;
   - a hit box under 44 CSS px at phone zoom.

   Run it before swapping. Keep a copy of the old `art-v3.js` as `art-v3.prev.js` for rollback.

### B. Art fixes from the self-critique
7. **Statue highlights, not neon.**
   - Make the specular rim a broken 1px cool line that sits only on the window-facing contours (shoulders, outer arm, outer leg, head). Use STAT_2 on the shaded side and STAT_HI only on short runs.
   - Remove the full blue outline. The rim must stay darker than GOLD.
8. **Finer gold cracks.**
   - Close-up: 1px kintsugi branches with a bright pixel at the junctions, no lightning zigzags. Grow the network by tier: t2 a few lines, then up to t5 the full network, with flakes at t4/t5 and glowing eyes at t5.
   - Full view: 1px veins with fewer, longer trunks, so they stay readable at phone size without looking like neon.
   - Add a seed point at the chest for t1.
9. **Roomier left sliver.**
   - Pull the door, kitchen counter and bed about 12 to 20 px toward the centre and drop one stacked prop per column.
   - Cut the "11" glyph and the poster that competes with the door. Keep the foreground crop to props only (speaker, filing cabinet).
   - Give the door/flyer board its own warm lamp pool.
10. **Readable dog.**
    - Redraw it at about 28x16: snout, an ear flap, a tail and a collar pixel in a category-neutral colour, curled asleep in the sun patch.
    - Add a second "lying, head up" pose for neglect as a variant or a separate item (`centre.dog` / variant `alert`), wired to `fx.js` placement.
11. **Visible downlight beam.**
    - The `window.statue-downlight` overlay becomes a hard-edged flat cone: 2 tones (inner GOLD_DK, outer TERRA_0) with stepped edges and no dither, from the fixture to the floor pool.
    - Add a bright floor ellipse and lift the statue's lit-side pixels by one step while it is on.

### C. Top review fixes (cheap, high value)
12. Light hierarchy:
    - The idle Today CRT moves from saturated red to a dim amber screen with a blinking cursor until the first log of the day (`window.today`).
    - Desaturate the props one value step. Skill objects get a resting 1px lighter outline (art), and the LEDs stay engine-drawn.
13. Small CRT (`window.stats`): an amber LCD with 2x-height digits. The engine alternates "72 OVR" and "12d" with a flame glyph, drawn after the LUT like the LEDs (`overlay.js`).
14. Plaque: five tier pips plus an in-tier gold bar, drawn by the engine from the overall score (`overlay.js`). The art only gives the blank plaque with the "III · FORGED" text area.
15. LEDs:
    - done = solid with a white centre and a 1px dark keyline, about 2x brighter than pending;
    - behind/never-miss-twice = the only blinking state;
    - the top-priority item gets the one pulse.
    - Priority ranks never-miss-twice, then Focus Rack pins, then lowest score due today. The same order sorts the Today list (`ui/today.js`).
16. Style pass:
    - sky reduced to 5 flat bands;
    - string-light bulbs 2x2 in fixed colours;
    - the radiator toned one step darker;
    - no single-pixel twinkles (they would also trip the grain check).
17. Edges: pull the gym rack and bike about 20 px inward and add a gym pendant pool. All 15 skill objects must sit inside a light pool or the sun patch.
18. Accessibility: each hotspot's DOM button aria-label includes the today state ("Strength, 52, done today"). Reduced motion turns the gold pulse and motes into instant LED changes.
19. Verify:
    - Render the full room plus all 7 zone framings at 1x and at 375px from the live prototype (`index.html`), with the stills at stages 0/1/2, t1 and t5, and night.
    - Run the unit tests (`tests/unit/room-camera.test.ts`), `merge.py` (palette and grain), `parity.py`, and the app `/room` route after `room-sync`.

**Data needs tonight:** none new. Use the existing ROOM_DATA (display score, tier, today %, streak, neglected, focus pins, never-miss-twice).

## LATER
- Sun position from the real clock, and lit house windows counting goals done (Q12).
- Day-complete sun flash and room pulse at 1.5s. Tier-up camera glide plus a permanent prop (Q13, Q14).
- Growth-slot caps with merge-to-prestige. Corkboard milestones, a bookshelf of monthly volumes, relic history (Q15, Q38).
- Morning and momentum grades on top of the LUT ladder (Q17).
- Colour-blind backups beyond the LEDs: calendar dot / check / X, chart arrows (Q18).
- Data-driven calendar (month tallies, streak) and a 7-bar or 14-day chart at zone zoom with 5px digits (Q11, Q20, Q28). Needs per-day history in ROOM_DATA.
- Streak break moment: crack once, then "0 · BEST n" (Q11).
- Long-press quick-log with 5s UNDO on the Today CRT (Q8).
- Status strip that expands into 15 bottles, with an "L" key (Q32, Q35).
- Statue body regions per category, with highlighting in the statue panel (Q36). Needs category totals.
- "?" sparkles on never-opened objects, a legend, and a one-time hotspot sweep (Q7, Q24).
- Dog zoomies on a tier-up. A one-time "welcome back" screen after 3+ missed days (Q26, Q27).
- Neglect escalation at day 3/7/14 (Q5). Needs days-since-last-log per skill.
- Sound set, off by default and offered once after the first log (Q37).
- Daily quest on the Today CRT plus a weekly chest with the review (Q40). Needs a quest generator and server state.
- Easter eggs: the tram at your usual log time, hanging plants that grow with days logged (Q39).
