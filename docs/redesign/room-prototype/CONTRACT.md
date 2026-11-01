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

## v3.5 contracts

Copied from the v3.5 implementation plan (sections 2.4 to 2.6), landed with the W0 seams. P/ is
docs/redesign/room-prototype/, A/ is art/room-r6/. Owners in brackets; W0 landed stubs with these names (nav.js,
skill.js, overview.js, wire.js are inert until their packages replace them).

### 4 Shared runtime contracts (owner in brackets)

**LightState `ls`** [P1 defines; W0 lands a legacy builder]. Navigation light state, NOT light.js's sun state `st`:
`{scene:'front'|'right'|'back'|'left'|'top', zone:id|null, focusK, dimK, poolK (0..1 floats), hover:id|null,
focus:id|null, inspect:bool, skill:id|null, statueLight:bool, snap:bool /* true inside snapshots: grain frozen, hover null */}`.
`ROOM.nav.ls()` returns the current one. Every renderer reads `ls`, never `ROOM.state.zone`/dimOn/hoverId.

**core.js** [W0, then P1]:
- `ROOM.stateItem(it)` -> `it.of ? ROOM.itemById(it.of) : it`; `variantOf`, `skillOf`, `featureOf`, `alertOn`, `scoreOf`,
  `growthOf` read through it.
- `ROOM.variantOf(it)` returns null for ids matching `/\.hero$/` (like `/closeup/`): heroes never draw in the room.
- `ROOM.heroOf(id) -> {item, img:imageId, hero:{anchor, float, rimSide, authored}}`: `<id>.hero` with the room item's
  current variant key (missing key -> `base`); fallback = the room sprite of the current variant, `authored:false`,
  `float:false`.
- `ROOM.sceneKey()` -> `'top'` when `ROOM.nav.place.mode === 'overview'`, else `normView(ROOM.state.view)`.
- `ROOM.placeOfItem(id) -> {view, zone, feature}` (zone from item.zone; `calendar` feature flagged).
- `ROOM.VIEWS` stays 4. strip.js `K.itemForSkill/itemForFeature` skip items with `of` or id `/\.hero$/` (W0).

**render.js exports** [W0 lands, P1 owns]: `ROOM.render.{blit, blitAux, plotMark, markDepth, drawLight, addMarkPass,
drawables, snap, ls}`.
- `plotMark(f, x, y, paletteIndex, depth, flags = 16|128)`: writes `f.buf`, aux (depth, flags, material 0), clears bit6,
  sets `f.mark[i] = 1`. The only writer of engine marks.
- `markDepth(d)`: contact-row depth (factored from blitAux).
- `addMarkPass(name, fn(f, ls, now))`: passes run after drawItems, before weather.draw, in registration order
  (`wire` P5, `heading` P4). Also run inside snapshots.
- `snap(place, ls, rectWorld, zS) -> {canvas, rect, z}` [P1].
- Frame `f`: `{buf, aux, mark, w, h, x0, y0, z, now, cam, org, atlas:{y, w, h, off:[dx,dy]}|null}`; `f.h` = room rows;
  buffers are `w x (h + atlasRows)`.

**Aux flag bits** (unchanged, INTERFACES 5): bit0 emissive, bit1 floor, bit2 floor seam, bit3 glass/sky, bit4 engine
mark (lit = albedo*1.15, never dimmed), bit5 leaf, bit6 hovered/focused hotspot OR hero texel (SELECT light applies),
bit7 no rim. Atlas texels are identified by row (`y >= f.h`), not a bit. Material 31 = "no cast" (R24, optional).

**gl.js** [P2]: `ROOM.gl.frame(f, opts)`; all new fields optional, absent = today's behaviour (except D4 3.3 changes):
```
opts = { dim: 0..1, focus: {rect:{x,y,w,h}, k} | null, hover: rect|null, pools, statueBurst, flash, state,
         atlas: f.atlas | null,
         hero: {x, y, k, K /* heroK dissolve 0..1 */, selK} | null,      // device px, integers
         halo: {cx, cy, r, k, pool:{cx,cy,rx,ry}, shadow:{cx,cy,rx,ry}} | null }  // world px
```
Removed: `opts.spot`, `opts.regions`, `focusAnim`. `ROOM.gl.setView('top', zones.views.top.lighting)` works like any view.
Reserved slots R7. `ROOM.emit('gltier', {tier})`. Tier steps only when `!ROOM.nav.busy` on a rest frame.
Pure helper exported for vitest: `ROOM.gl.selectLights(lights, artRect, reserved) -> array` (module.exports in a tiny
`gl-lights.js` section is acceptable only if P2 splits it; otherwise test via Playwright).

**nav.js** [P1]: `ROOM.nav = {place, target, busy, ls(), request(place, opts{history, instant, source, opener}),
up(), down(), back(), heading(dir), whenIdle()}`; events `'nav' {phase:'start'|'land'|'cancel', from, to, kind}`,
`'overview' {on, ret}` (at land/leave), legacy `'zone'`/`'view'` at land. Wrappers: `ROOM.go/turn/turnTo` (3 lines
each), `ROOM.feature.busy = () => ROOM.nav.busy`, `ROOM.render.dolly/turning` getters for one release.
`nav.busy` true while a move runs, a request is queued, an ls tween or hero leg runs, or onLand is pending.

**skill.js** [P3] (D1 4): `ROOM.skill = {open(id, {opener, source:'click'|'board'|'overview'|'route', instant}) -> bool,
close({instant, restoreFocus=true}), isOpen(), current(), rectCss(), layout({vw,vh,dpr,board,sheetTop,heroW,heroH,
zRoom,zZone}) -> {x,y,k} (pure, module.exports), heroState(now) -> {rectDev:{x,y,w,h}, k, heroK, selK, id, variant} | null,
backdropCamera(place, from), atlasRows() -> int, frame(f, ls, now) -> {hero, halo} | null, drawCanvas2D(ctx, f, tr, now, ls),
lift(id, {fromRectDev, instant, source}) -> ms, drop({instant}) -> ms, swap(id) -> ms, cancel('reverse'|'snap'), busy()}`.
`open/close` are façades over `ROOM.nav.request` / `ROOM.nav.back`; nav calls the legs. Event `'skill' {id, phase:
'lift'|'shown'|'drop'|'closed'}`. `ROOM.debug.state.skill`. skill.js opens the board itself at LIFT u = 0.66 (laptop)
or u = 0 (phone) via `ROOM.ui.open(id, {side:'right', hero:true, opener})`.

**overview.js** [P4] (D2 3): `ROOM.overview = {camera(vw, vh, dpr, zRoom) -> {z, ox, oy}, snapshot(ls) -> {canvas, z, rect}
(wrapper over render.snap with scene 'top'), anchor(place) -> {x,y,w,h} (overview art px), placeAt(xCss, yCss) -> Place|null,
heading /* getter = nav.place.ret.view */, toggleList(), onEnter(), onLeave()}`; registers mark pass `'heading'`
(only when `ls.scene === 'top'`). DOM: `#overview-list button[data-of]` rows, hint and LIST plates; CSS `P/ui/overview.css`.
Hotspot buttons are built by overlay.js from scene-'top' drawables: `.hs[data-id="top.<roomId>"][data-of="<roomId>"]`.

**wire.js** [P5] (D3 3): `ROOM.wire = {active:true, data(item, variantKey) -> {hull, nodes, cage|null, cageNodes|null},
styleOf(id, ls) -> {kind:'wire'|'hot'|'cage'|'socket'|null, line, node, ink, breathe, dash, bit4}, draw(f, id, style)}`,
`ROOM.markStateOf(slug) -> 'off'|'pending'|'top'|'half'|'full'|'neglect'|null`, `D.wire(img)` runtime fallback in
decode.js, mark pass `'wire'`. Styles `'rest'|'hot'|'cage'|'socket'` (`'hover'` alias = cage-or-hot by gate).
Overview items: rest/hot only.

**light.js** [W0 creates, P2 owns]: `ROOM.light.SELECT` (R8).

### 5 overlay.js duties for the new places [P1 implements]
- `activate(d)`: `ROOM.nav.request(skillPlaceOf(d.item.of || d.item.id), {source, opener})`; calendar feature -> zone
  calendar. Touch on a wall: zone first.
- In overview (`ls.scene === 'top'`): buttons for `top.*` hotspots only (decor never), min 44x44 CSS for all pointers,
  touch enabled, ties = nearest centre, smaller box on top; aria-label `"<Label>, <stage or state>"` via
  `ROOM.markStateOf`; chevrons and zone dots hidden; title "OVERVIEW"; `nav` landmark "Room overview" on the button layer.
- `#nav-up` (44x44, pixel chevron up/down like turn chevrons, in photo-mode hide list), chevrons/dots/nav-up call nav.
- `drawMarks` plates go through `plotMark`.

### 6 Bundle data formats [producers P6/P4; consumers P3/P4/P5]
- **Hero items** (P6): `{id:'<id>.hero', kind:'overlay', of:'<id>', view, zone, layer:6, x, y, w, h,
  variants:{<key>: imageId} /* subset of the room item's keys */, hero:{anchor:[x,y] /* world px, default room bbox
  bottom-centre */, float:bool, rimSide:'left'|'right'|null, authored:bool, led:[x,y]|null /* hero-local */}}` +
  `.mat.png` sidecars. NO `target`, NO `hit`. Authored (v3.5): library.bookshelf READING stack (54x47; s0/s1/s2 =
  3/5/7 books, ribbon at s2), bed alarm clock (~34x26), visualization plasma globe (~30x34), food bowl (~42x30),
  meditation cushion + candle (~50x30). All other hotspots: isolate export (complete, un-occluded).
- **Overview items** (P4): hotspot twins `{id:'top.<roomId>', kind:'hotspot', view:'top', of:'<roomId>', zone, layer,
  x, y, w, h, variants (same keys as the room item), hit, led?, screen?, wire?}`, never `target`/`label` (label comes
  from the twin). Decor `top.<decorId>` kind `deco`; shell `shell.top-*` (base + night); `.mat.png` sidecars.
- **zones.views.top** (P4): `{art:{x,y,w,h}, core:[x0,y0,x1,y1], lighting:{same schema as views.<v>.lighting:
  floor, ambient, facing:null, yaw:null, window:{rect:null}, key:{centre, radius, mullions}, lights:[{id:'top-N',
  type:'point', pos:[x,y], rgb, intensity, radius, when}], lightsNight, materials, noRim:['top.*']}, light:{day, night}
  (Canvas2D glows), anchors:{front|right|back|left|<zoneId>: [x,y,w,h]}, territory:[{zone, poly:[[x,y],...]}]}`.
  `ROOM.VIEWS` never includes 'top'.
- **item.wire** (P6 for room hotspots, P4 for `top.*`): `wire:{<variantKey>: {hull:[x,y,...], nodes:[x,y,x,y,x,y,x,y],
  cage:[x,y,...]|null, cageNodes:[x,y,...]|null, gate:{over:[l,t,r,b], under:[l,t,r,b]}}}`; flat int arrays of art px
  RELATIVE to the item's x,y, occlusion already removed; keys only for silhouette-changing variants, else `base`.
- **Box table** (P6, build-internal): `B.box_table() -> {id: {view, kind:'box3d'|'card'|'anchors'|'billboard',
  world:[X0,Y0,Z0,X1,Y1,Z1] ft, src:'exact'|'fitted'|'BOUNDS'}}`; dumped to `A/boxes.json` (generated, ignored by merge).
  Until P6-M1 lands, P4 uses `S/u4/r6b/dump/hotspots.json` (same fields).
- Build hook (W0): `export_live()` calls `overview.export(B, manifest, zones)` when `A/overview.py` exists
  (`B` = the build module, `sys.modules[__name__]`). merge.py runs every `A/*_check.py` with a `run(items, zones) -> errs` (P6-M1), so
  P4's `A/overview_check.py` needs no merge.py edit.

### v3.5 navigation as built (P1)
- `engine/nav.js` is the only mover. `ROOM.nav = {place, target, scenePlace, busy, leg, ls(), request(place, opts),
  up(), down(), back(), heading() /* no-op, A1 */, whenIdle(), go/turn/turnTo (wrappers), tick(now) /* render.js */,
  snapMove(), setBoardDim(on), skillPlaceOf(id, from), placeFromUrl(src), urlOf(place), boot(src), route(src),
  overviewOn(), planFor, policy, routeOf, parseRoute, debug()}`. Pure `planFor/policy/routeOf/parseRoute` are in
  `module.exports` (tests/unit/room-nav.test.ts).
- Skill places carry `base: 'wall'|'zone'` and `baseZone` (the backdrop camera); `zone` is the item's own zone
  (route `/room/<zone>/<item suffix>`). `ROOM.zoneOf(item)` (core.js) gives that zone.
- `nav.scenePlace` is the place the rest frame draws (a live leg's target inside a move); `ROOM.sceneKey()` reads it,
  and `ROOM.render.sceneOverride` while a snapshot of another scene is drawn.
- Legs: camera legs `turn | dolly | rise | descend` are drawn by `ROOM.render.beginLeg/drawLeg` from shots (exact
  rest frames, screen size) and snapshots (`ROOM.render.snap`, <= 6 MP, zoom dividing the end zoom); live legs
  `lift | drop | swap` call `ROOM.skill.lift(id, {fromRectDev, instant, source}) / drop({instant}) / swap(id)`
  (their return value in ms sets the leg length; the light tween is 240 ms) and render live rest frames.
- The board: skill.js opens it during LIFT; nav opens it at landing when it is not open yet (`ROOM.ui.open(id,
  {opener, side: 'right', hero: true})`) and closes it at the start of any move leaving the skill place. A board
  closed by itself (Esc, Close, scrim: the `state` event with `ROOM.state.panel` null) makes nav step back.
  `ROOM.setDim(on)` is a board dim without a move (not navigation): `ls.dimK` tweens, ignored in a skill place.
- Events: `nav {phase: start|land|cancel, from, to, kind}`, `overview {on, ret}`, legacy `zone`/`view` at landing
  (push false: nav owns history). `ROOM.state.zone` (and `statueLight`) are mirrors written at landing.
- `ROOM.overview.camera()` may return `{z, ox, oy}`; render.js converts it to a centre camera with the same integer
  origin. Overview availability: `zones.views.top` exists and `ROOM.overview.camera` is a function.
- `glow.post(f, ls, gpu)` and `overlay.drawMarks(f, ls)` take the frame's light state.
