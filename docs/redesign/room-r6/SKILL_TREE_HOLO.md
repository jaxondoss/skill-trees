# Skill tree hologram (room v3.6 spec)

Status: SPEC for Jaxon's approval. No engine or app code changes in this task. Plan:
`whimsical-popping-blanket` (approved). Mockups: `stills/holo/` (PIL composites over real v3.5 room frames at the
room's integer zoom; every hologram pixel is a palette colour on the art grid, see 5).

| Still | Shows |
| --- | --- |
| `stills/holo/gym-peek-sunset.png` | Hover peek on the squat rack (strength, athletics ramp): centre + 4 branches with counts |
| `stills/holo/gym-lift-expanded-sunset.png` | Pinned, LIFT branch expanded to its leaves (tiers + last 7 strip), OPEN button |
| `stills/holo/gym-lift-expanded-night.png` | The same at night (marks stay palette-true) |
| `stills/holo/front-reading-peek-sunset.png` | Front wall, bookshelf (reading, shown with the school ramp), peek |
| `stills/holo/front-reading-steps-sunset.png` | Pinned, STEPS expanded; leaf labels over the bright window get the contrast plate |
| `stills/holo/front-reading-steps-night.png` | The same at night (window dark, no plate needed) |
| `stills/holo/phone-longpress-reading-sunset.png` | Phone 390 x 844: long-press pinned, tree in the band above a short sheet, 44 px leaf rows |

Frames are 1280 x 800 at zoom 2 (1 art px = 2 x 2 device px, measured: horizontal runs of 2 dominate and start on
even columns). The phone still is 1170 x 2532 (dpr 3) at 6 device px per art px.

---

## 1 Intent and scope

Jaxon likes the branching node tree in his reference (a glowing centre node that splits into groups, then fans curved
lines to a column of leaves). The room gets its own version: hover a skill object and a small, crisp hologram tree
unfolds beside it, accordion style.

Decisions (from the Q&A, binding):
- Only the branching tree. The reference's detail panel, chart, AI box and toolbar are out of scope.
- Room only (walls and zones). Not the admin view; the overview keeps its direct skill view in v1 (10, Q4).
- Tree data: centre = the skill; branches = its goals, steps and metric; leaves: goal -> tiers and recent logs,
  steps -> each step, metric -> recent values by day.
- Look: subtle, matches the room, does not swamp the art, "definitely crispy": pixel-true edges, no blur on lines,
  in the skill's category colour, translucent (by ordered dither, see 5).
- Placement: beside the hovered object toward the emptier side, about a third of the screen wide at most; the room
  dims slightly.
- Behaviour: hover or focus peeks the compact tree (centre + branch nodes with counts). Clicking a branch expands it in
  place to its leaves and collapses the others (accordion). Clicking the OBJECT pins the tree and REPLACES today's
  direct skill view; the skill view opens from the tree (the OPEN button on the centre node, or any leaf, which
  opens the skill view at that item).
- Motion: lines grow out in a few stepped frames, a faint scanline and one flicker, nodes pulse once; static under
  reduced motion.
- Phone: long-press a skill object shows and pins the tree; a tap on an object follows the same rule (object = tree).

Out of scope (v1): feature hotspots (statue, calendar, Today, relic mounts, settings, review), editing from the tree,
trees in the overview, sound, any change to art files, the admin view.

## 2 Interaction model and state machine

### 2.1 States

```
idle --hover 120 ms / focus--> peek --click object / Enter / long-press--> pinned --click branch--> expanded(b)
 ^                               |                                          |   ^                     |
 |<----- leave 200 ms grace -----+                                          |   +--click same branch--+
 |<---------------- Esc / click outside / any nav move ---------------------+---- Esc (expanded -> pinned)
 pinned|expanded --OPEN on centre / Enter on centre--> skill view (nav place 'skill', at: null)
 expanded --click leaf / Enter on leaf--> skill view (at: the leaf's item)
```

- `idle`: today's behaviour: rest wires (wire.js), no tree.
- `peek` (mouse hover after a 120 ms intent delay, or keyboard focus on the object's button, no delay): the compact
  tree (centre, branch nodes, branch labels with counts). Not interactive with the pointer except that moving into
  the tree's DOM box keeps it open (so the pointer can travel to a branch). Leaving both the object and the tree box
  starts a 200 ms grace, then the tree retracts. Hovering another object retargets after its own 120 ms delay.
  Peek on a fine pointer turns into `pinned` as soon as a branch is clicked.
- `pinned`: the tree stays without hover and gains the OPEN button under the centre node. Entered by a click on the
  object, Enter on the focused object button, a click on any branch during peek, or a long-press (phone).
- `expanded(b)`: one branch open to its leaves; others collapse to node + count (accordion, at most one open).
  Clicking the open branch again collapses it (back to `pinned`).
- skill view: unchanged v3.5 skill place; the tree retracts as the LIFT leg starts.

State lives in `ROOM.holo` (new engine module, 11) as `{item, phase: 'idle'|'peek'|'pinned'|'expanded', branch,
t0}`. It is UI state on the current place, mirrored to `ROOM.state.holo` like `ROOM.state.inspect`.

### 2.2 Composition with ROOM.nav

The pinned tree is an overlay on the wall or zone place, NOT a nav place: no history entry, no URL (routes stay
`/room/<zone>/<item>` for the skill view only, nav.js:112). Reasons: it is transient like inspect, and the skill
view must stay one Back away from the wall. Rules:
- Any `nav` event with `phase: 'start'` (TURN, DOLLY, RISE, zone steps) closes the tree instantly, the way wire.js
  resets its motion (wire.js:497-500).
- Opening the skill view: `ROOM.nav.request({mode: 'skill', item}, {source: 'holo', opener, at})` (the same call
  overlay.js makes today, overlay.js:291), with the new optional `at` (2.5). Back from that skill view lands on the
  wall or zone with the tree CLOSED and focus on the object button (the opener), not re-pinned.
- Clicking an object while another tree is pinned retargets (pins the new one). Clicking empty room while a tree is
  pinned closes the tree and does NOT also step into the zone (one action per click); the next click steps in.
- In a zone on a touch device today's first tap on a wall object steps into the zone (overlay.js:284-289). That stays
  for a TAP on a wall; a long-press on a wall object steps into the object's zone and pins its tree at landing.

### 2.3 Esc and click-outside order

Esc today (input.js:153-160): overview -> inspect -> photo -> zone/skill back. New order (holo slots in before back):

1. overview: down (unchanged)
2. inspect off
3. photo off
4. `expanded` -> `pinned` (collapse the branch, focus moves to that branch node)
5. `pinned` or `peek` -> `idle` (focus returns to the object button)
6. zone or skill: `nav.back()` (unchanged)

Click outside the tree and the object: closes in one step from `expanded` or `pinned` (no intermediate collapse).
An open board or sheet still owns the keyboard (input.js:110-117), so the tree never sees keys while a skill view is
open.

### 2.4 The hover cage, nameplate and wires

- The P5 cage (wire.js:6-9: hover / focus / touch hold) stays exactly as it is: it is the object highlight. The tree
  is drawn beside it in its own mark pass registered after `wire` (render.js:396-405 keeps registration order), so
  tree pixels sit on top of cage pixels where they overlap.
- The nameplate ("STRENGTH 52", overlay.js:166-174) is suppressed for the item whose tree is showing: the centre
  node carries the name (above) and level or score (inside), so the plate would duplicate it.
- While pinned, `ls.hover` stays on the item so the cage holds without the pointer.

### 2.5 The skill view entry

- Today a click on the object calls `nav.request({mode: 'skill', item})` (overlay.js:274-292). New: `activate(d)` on a
  skill hotspot pins the tree; features keep their old path (Today panel, calendar). The skill view request moves to
  the tree: OPEN on the centre (and Enter on the centre item) and every leaf.
- LIFT: `ROOM.skill.lift(id, opts)` starts the hero from the item's room rect (skill.js:424 `from = roomRect(h)`); that
  stays (the art must not jump). The tree retracts into its centre node in 2 stepped frames (2 x 40 ms) at the leg's
  start, and the lift's selection light and halo (selK, haloK, skill.js:411-413) start from the centre node's position
  via a new `opts.fromHolo = {x, y}` (device px), so the view reads as growing out of the hologram node.
- `at` (new, optional) reaches the board through `ROOM.ui.open(id, {opener, side, hero, at})` (ui/panel.js:133):
  `{tab: 'today'|'steps'|'data', key}`: goal and tier leaves -> Today tab with that goal focused; recent log leaf ->
  Data tab, that day; step leaf -> Steps tab, that step focused; metric leaf -> Data tab, that day; "+N MORE" -> the
  branch's tab with no key.

### 2.6 Keyboard

- Tab reaches object buttons in DOM order (overlay.js:301-333, unchanged); focus on a skill object peeks at once.
- Enter on the focused object pins and moves focus into the tree (the centre item). Space does the same.
- Inside the tree (roving tabindex, one tab stop): Up / Down move between siblings (branches, or leaves of the open
  branch); Right on a branch expands it and moves to its first leaf; Left on a leaf goes to its branch, on a branch
  collapses it, on the centre does nothing; Home / End first / last sibling; Enter on the centre opens the skill
  view; Enter on a branch toggles it; Enter on a leaf opens the skill view at that item. Tab leaves the tree to the
  next object button (the tree closes back to peek on that object).
- Arrow keys inside the tree are consumed (`preventDefault`), so input.js's wall turn and zone walk (input.js:131-139)
  do not fire: input.js already returns early on `e.defaultPrevented` (input.js:106).

### 2.7 Screen reader

The overlay DOM mirrors the tree as an ARIA tree, positioned over the drawn tree so hit testing and focus rings align:

```html
<div class="holo" role="tree" aria-label="Strength skill tree">
  <div role="treeitem" aria-level="1" aria-expanded="true" tabindex="0">Strength, level 52. Open skill view
    <div role="group">
      <div role="treeitem" aria-level="2" aria-expanded="true" aria-setsize="4" aria-posinset="1">Lift, 5 of last 7 logged
        <div role="group">
          <div role="treeitem" aria-level="3">Floor, 20 minutes, done today</div> ...
          <div role="treeitem" aria-level="3">Last 7 days: 5 logged, 1 missed, today open</div>
```

- Labels are full words (no abbreviations, no em dashes): the drawn label is short, the accessible name is complete.
- The polite live region (overlay.js) announces "Strength tree pinned, 4 branches" on pin and "Lift expanded,
  4 items" on expand. Peek announces nothing (focus already names the object).
- The DOM nodes are transparent and carry hit boxes only (5.5); text is drawn in the frame.

## 3 Data contract

### 3.1 Sources (ROOM_DATA, src/lib/data/room.ts `loadRoomData`)

Per skill (room.ts:143-178): `slug, name, category, score, level, logKey, logUnit, series` (last 14 metric values,
room.ts:122), `goals[]` (non-negotiables: `name, floor, standard, stretch, minutes, intention`, room.ts:166-175),
`steps[]` (`title, points, claimed`, room.ts:176). Today's goals: top-level `goals[]` (room.ts:180-190: `skill,
tier, result, nmt`). Category ramps: `ROOM.art.palette.categories` (fallback ui/strip.js:24-27, `K.cat` at
ui/strip.js:38-42).

### 3.2 Additions to loadRoomData (small, additive, typed by `RoomData`)

- `skills[].goals[].id` (the non-negotiable id) and `skills[].goals[].recent`: last 7 planned days for that goal,
  oldest first, `{day: 'YYYY-MM-DD', tier: 'floor'|'standard'|'stretch'|null, planned: tier}` from `ctx.history`
  filtered by `nonNegotiableId` (`GoalRecord`, src/lib/data/context.ts:32-39). ~7 x goals rows, no new query.
- `skills[].seriesDays`: the day of each `series` value (same order), so metric leaves can say when. Additive; the
  sample data in `scripts/room-proto-data.ts` gets the same fields.

### 3.3 Node shape and builder

```ts
type HoloNode = {
  id: string;                       // stable: 'strength', 'strength/g/<goalId>', 'strength/g/<goalId>/t/floor', ...
  kind: 'center' | 'goal' | 'steps' | 'metric' | 'leaf';
  label: string;                    // drawn text, upper case, <= 14 chars
  name: string;                     // accessible name, full words
  value: string | null;             // branch count or leaf value ('5/7', '185', '20M')
  state: 'done' | 'open' | 'missed' | 'none';
  strip?: ('done' | 'open' | 'missed' | 'none')[];   // the recent-logs leaf only
  at?: { tab: 'today' | 'steps' | 'data'; key?: string };
  children: HoloNode[];
};
```

Pure `buildTree(skill, todayGoals, today)` in engine/holo.js, exported through `module.exports` for Vitest like
nav.js's pure helpers. Branches, in order:
1. One `goal` branch per goal (today's planned goal first). Value `logged/planned` over `recent`. Leaves: FLOOR,
   STANDARD, STRETCH with their minutes (state `done` when today's result reached that tier, `open` when it is
   today's planned tier and unlogged, else `none`), then ONE recent-logs leaf "LAST 7" drawn as a 7-dot strip
   (`done` logged, `missed` planned and unlogged on a past day, `open` today unlogged, `none` not planned). The
   strip keeps "tiers and recent logs" inside the 8-leaf cap; the accessible name spells out the counts.
2. One `steps` branch when `steps.length`: value `claimed/total`; one leaf per step (`done` claimed, else `open`).
3. One `metric` branch when `logKey`: label from the unit (BENCH, PAGES, RATING), value = latest value; leaves = the
   last up to 7 values newest first, "NOV 9 185" (state `none`).

Caps: at most 6 branches (goals beyond 4 fold into the last goal slot as "+N GOALS", opening Today); at most 8
leaves per branch: 7 leaves + a "+N MORE" leaf. Empty skill (no goals, steps or metric): the centre node alone with
OPEN; the tree still pins.

## 4 Layout

All geometry is computed in art px of the current wall (buffer coordinates `f.x0/f.y0` like overlay.js:160-170) and
rounded to whole art px, so it is pixel-true at any integer zoom. Recomputed on pin, expand, resize, zoom change and
data change; cached in between.

### 4.1 Anchor and side

- Anchor: the item's hit box at rest (`cssRectOf`, render.js:1616-1626, art px = hit + layer offset; the same box
  `ROOM.itemRectCss` returns, render.js:1599-1613).
- Free space each side: the visible wall rect minus margins: the HUD strip (top, its bottom + 4 art px), the turn
  chevrons (left and right 20 art px), the zone dots row and the "D CONTROLS" chip (bottom 16 art px).
- Side = the side with more free width; ties go right. Board side rule: on laptops the skill board is always right
  (HANDOFF v3.5); the tree is gone before the board opens, so the board never constrains the tree. When neither side
  fits the full width, the centre node may overlap the object's hull by up to 14 art px (the gym still does this:
  the centre sits on the rack's upper right corner), then labels are truncated to 10 chars (accessible names stay).
- Centre node: on the chosen side of the hull, vertically at the hull's top third, clamped into the margins.

### 4.2 Fan (as drawn in the stills)

- Branch nodes on an arc: `y_i = cy + (i - (n - 1) / 2) * GAP`, `x_i = cx + s * sqrt(R^2 - (0.6 * (y_i - cy))^2)`,
  s = +1 right, -1 left. Trunks are quadratic curves from the centre node's edge (control point at `cx + s * R / 2,
  y_i`).
- Branch labels: right of the node (or left when s = -1), 6 art px from its centre.
- Expanded branch: a straight 1 px run from the end of its label to `ex` = the widest branch label end + 3 (so the
  leaf curves never cross the other labels), then quadratic curves to a leaf column on a second shallow arc:
  `x_j = ex + s * LEAD - s * 0.12 * |y_j - y_b|`, leaves spaced `LEAF_GAP`, centred on the branch, clamped to the
  margins. Leaf dot 3 x 3, label 4 art px after it.

### 4.3 Sizes per breakpoint

Art-px constants; CSS size = art px x (z / dpr). The leaf gap grows so each row is a full target (overlay.js
rule: >= 24 CSS px on fine pointers, 44 on touch, overlay.js:9-10).

| Viewport | zoom (device px / art px, check) | R | GAP | LEAF_GAP | LEAD | Max tree width |
| --- | --- | --- | --- | --- | --- | --- |
| 1280 x 800 | 2 | 44 | 18 | 12 (24 CSS) | 28 | ~190 art px = 380 CSS (30 %) |
| 1440 x 900 | 2 | 44 | 18 | 12 (24 CSS) | 28 | ~190 art px = 380 CSS (26 %) |
| 1920 x 1080 | 3 | 44 | 18 | 12 (36 CSS) | 28 | ~190 art px = 570 CSS (30 %) |
| phone 390 x 844, dpr 3 | 6 (2 CSS per art px) | 18 | 24 | 22 (44 CSS) | 10 | full band width minus 8 art px |

`LEAF_GAP = max(12, ceil(minTarget / (z / dpr)))`. Fine pointer: minTarget 24; touch: 44.

### 4.4 Collisions

The tree box is clamped inside the margins; the leaf column shifts vertically before anything else moves; then the
whole tree shifts away from the edge; then labels truncate. The tree never covers the HUD strip or the chevrons. It
may cover other room objects (it is translucent and their hotspot buttons stay reachable by keyboard; pointer hits
inside the tree box go to the tree while it is pinned).

## 5 Rendering

### 5.1 Where it draws

An engine mark pass: `ROOM.render.addMarkPass('holo', pass)` (render.js:396-405), registered after `wire` so it runs
after the cage; mark passes run after drawItems and before weather (render.js:773-775). Every pixel goes through
`ROOM.render.plotMark(f, x, y, c, depth, flags)` (render.js:379-392): palette index, aux depth 254 (in front of
everything, as fx.js:407-414 does for its trail), flags `16 | 128` (engine mark, no rim) for lines and fills and
`1 | 16 | 128` (also emissive, as the LED pixels at fx.js:157) for the bright cores and the centre ring. So the tree
is in the frame buffer, pixel-true, lit by the GPU like other marks but never below 70 % of its palette colour
(wire.js:12-13), and the Canvas2D path shows it palette-true.

Labels: drawn as marks too, with the room's 3x5 pixel font (overlay.js:22-36, the nameplate font), and an INK 1 px
keyline. This differs from the plan's preferred "DOM labels in the pixel font": DOM text cannot be guaranteed to
land on the art grid under the GL upscale and dpr, and it would sit outside the frame's lighting and dim. The DOM
keeps the accessible tree and the hit boxes (2.7, 5.5). Fallback if Jaxon prefers DOM text: Silkscreen
(`--f-pixel`) at `8 * z / dpr` CSS px, positioned on whole art px (Q1).

### 5.2 Hologram treatment (palette only, no alpha)

The frame buffer is palette indices, so "translucent" means ordered dither: the art shows through the gaps. Ramp
`[dark, mid, light]` = `ROOM.art.palette.categories[skill.category]` (athletics TERRA_0 / CRT_0 / CRT_1, school
SLATE_0 / SLATE_1 / SLATE_2, mind PLUM_1 / PLUM_2 / PLUM_3, ...).

| Element | Pixels |
| --- | --- |
| Idle trunk (centre -> collapsed branch) | 1 art px pixel-perfect curve (no L corners), `mid` |
| Hot line (active trunk, leaf curves) | 1 art px core in `light` + halo: the two perpendicular neighbours in `dark` where Bayer 4x4 < 6/16, even rows only |
| Centre node | ring r 6 `light` (emissive); fill: Bayer 9/16 `mid` on even rows, 3/16 `dark` on odd rows; halo r 7..11 `dark` at 5/16, even rows; level or score in CREAM 3x5 inside |
| Branch node | ring r 3 (`light` open or active, `mid` collapsed during expand), same dithered fill |
| Leaf dot 3 x 3 | done: solid `light`; open: ring `mid`; missed: `dark` with INK centre; none: one `mid` pixel |
| Labels | 3x5 font; done leaves and the active branch in CREAM, others `light`, collapsed `mid`; INK 1 px keyline |
| OPEN button | 9 art px plate: `light` border, INK / `dark` dither fill, "OPEN >" in CREAM |
| Scanline | every odd art row carries no halo and a thinner fill (built into the rows above): the faint scanline |

No smooth blur anywhere. Glow comes only from the existing bloom on emissive mark pixels, which gl.js already caps
for marks (gl.js:512 `if ((f & 16) != 0) bl = min(bl, vec3(0.004))`); marks also skip grain (gl.js:515). No new
GPU pass, texture or shader flag.

### 5.3 Room dim

The room dims slightly: peek 12 %, pinned 20 % (the skill view dims to ~40 %, HANDOFF v3.5). Marks keep their
colour because the dim skips bit4 pixels (the same reason wire.js drops bit4 from rest wires to make them recede).
Implementation: `ROOM.setDim` (render.js:1591-1594) takes a number 0..1 instead of a boolean (true keeps meaning
the board dim), tweened over 120 ms; reduced motion snaps.

### 5.4 Night, rain, contrast floor

- Night: no change; marks are palette-true with the 70 % floor (`gym-lift-expanded-night.png`,
  `front-reading-steps-night.png`).
- Rain: weather draws after mark passes (render.js:775), so streaks cross the tree like any in-room light. Kept on
  purpose (it is in the room). Photo mode hides the tree.
- Contrast floor: every label keeps a 1 px INK keyline. When the mean luma of the art under a label box exceeds 110
  (of 255, from the lit frame of the last rest render), a 50 % Bayer INK plate goes behind that label (the window
  leaves in `front-reading-steps-sunset.png`). Target: label core vs its surround >= 3:1 measured like the wire AC
  (HANDOFF v3.5: >= 3:1 on every wall).
- Palette rule: only palette colours; category ramp plus CREAM and INK. Unknown category: the gold ramp (strip.js
  fallback).

### 5.5 Hit boxes

DOM `treeitem`s are absolutely positioned boxes over each drawn node row (dot + label, at least 24 x 24 CSS on fine
pointers, 44 x 44 on touch), transparent, with focus rings drawn as marks (a 1 px CREAM bracket at the row ends) so
focus stays pixel-true.

## 6 Motion

All steps run on `ROOM.now()` (debug freeze and advance work) and redraw only while busy, like wire.js `busy()`
(wire.js:479-484).

| Event | Timeline |
| --- | --- |
| Peek in | f0: centre ring; f1..f4 (4 x 40 ms): trunks revealed 25 % of their pixel path per frame; f4: branch nodes appear with one pulse (ring in CREAM for 80 ms, then `light`); labels in 2 Bayer steps (2 x 40 ms). Total ~240 ms |
| Flicker | once at peek in: the halo pixels drop for frame f2 only (40 ms) |
| Scanline sweep | once at pin: a 4-row band with no halo moves top to bottom over 320 ms in 40 ms steps; never loops |
| Expand | leaf curves 4 x 40 ms; leaf dots pop on the last frame (one CREAM pulse 80 ms); the other branches collapse in 2 x 40 ms (labels to counts) |
| Collapse | reverse of expand, 2 x 40 ms |
| Retract (leave, Esc, nav start, skill view) | 2 x 40 ms into the centre node, then gone; nav start: instant |
| Rest | static: no breathing, no idle loop (zero cost when idle) |

Reduced motion (`prefers-reduced-motion` or `?motion=0`, core.js:193-199): every state change is instant and
complete, no flicker, no pulse, no sweep; the 120 ms hover intent delay stays (it is not motion).

## 7 Phone

- Long-press 350 ms on a skill object pins its tree (on a wall: step into the object's zone, pin at landing).
  Cancelled by movement over 8 px (it is a pan) or pointerup before 350 ms (a tap). Haptic-free (no
  `navigator.vibrate`). The `.hs` buttons get `-webkit-touch-callout: none` and `user-select: none`; `contextmenu`
  is prevented on them so the OS menu never appears.
- A tap on a skill object in a zone pins the tree too (object = tree). A tap on a wall object still steps into the
  zone first (overlay.js:284-289).
- Layout: the tree takes the band above a short sheet (`phone-longpress-reading-sunset.png`): the sheet shows the
  skill header (as the v3.5 sheet) plus one 44 px "OPEN SKILL VIEW" button and two hint lines ("TAP A LEAF TO OPEN
  IT THERE", "TAP THE ROOM OR SWIPE DOWN TO CLOSE"). The sheet is a compact mode of the existing board
  (`ROOM.ui.open(id, {mode: 'holo'})`), not a new component (Q5).
- Leaf rows are 22 art px apart (44 CSS at 2 CSS per art px); the tree uses the band width; labels truncate at 10
  chars.
- Close: tap empty room, swipe the sheet down, or the sheet's close button. Android Back: the tree has no history
  entry, so Back today would run nav's popstate move (nav.js:682); the build either pushes a throwaway entry while
  pinned on the phone or accepts that Back leaves the zone (Q8).

## 8 Performance budget

- Mark pass under 0.3 ms per frame in headless Chromium with SwiftShader at 1280 x 800 (measured like wire.js
  `lastPassMs`, exposed as `ROOM.holo.lastPassMs`).
- Pixel lists (lines, discs, labels, plates) are built once per layout and cached; a frame is one loop of
  `plotMark` over at most ~3,000 pixels (the expanded gym tree in the still is ~2,900 art px including keylines and plates).
- No extra GPU passes, textures or uniforms; frames are only requested while `ROOM.holo.busy(now)` is true.
- `buildTree` and layout under 1 ms on pin or expand.

## 9 Acceptance criteria and tests

### 9.1 Acceptance (measurable)

1. Hover on a skill object for 120 ms shows the peek; under 120 ms shows nothing; focus shows it at once.
2. Peek in completes in <= 260 ms; reduced motion: complete in the same frame.
3. Click on the object pins; it no longer opens the skill view. OPEN and every leaf open it (leaf: correct tab and
   item focused).
4. At most one branch expanded; at most 6 branches and 8 leaves drawn.
5. Every tree pixel is a palette colour and lies on the art grid (crisp harness: zero non-palette colours inside the
   tree box on the Canvas2D path; on GL, every 2 x 2 (z = 2) block inside the tree is uniform).
6. Tree box <= 34 % of the viewport width at 1280, 1440 and 1920; never overlaps the HUD strip or chevrons.
7. Label contrast >= 3:1 against the surround on every wall, day and night.
8. Hit targets: >= 24 CSS px on fine pointers, >= 44 on touch.
9. Esc order as 2.3; focus returns to the object button on close and to the opener after the skill view closes.
10. Screen reader: role tree with correct levels, expanded state, set size and position; names in full words.
11. Mark pass < 0.3 ms (SwiftShader); no new GPU passes.
12. No art pixel changes outside the tree box: the frame's palette index buffer with the tree pinned equals the
    buffer without it everywhere outside the tree box (the dim is GPU-side and does not touch indices).

### 9.2 Tests

Unit (Vitest, tests/unit/room-holo.test.ts): `buildTree` (branch order, counts, tier and strip states, caps and
"+N MORE", empty skill, unknown category); layout (side choice, arc and column positions are integers, clamping to
margins, truncation, leaf gap per pointer and zoom); input state machine (intent delay, grace, Esc order).

Data (tests on room.ts): `goals[].id`, `goals[].recent` (7 max, oldest first, tiers), `seriesDays` length equals
`series`.

e2e (Playwright, tests/e2e/room-holo.spec.ts, helpers from room-helpers.ts): hover peek; click pin; accordion (expand
one, the other collapses, click again collapses); Esc order; click outside; leaf opens the skill view at the item
(tab and focused row); OPEN opens it; Back returns with the tree closed and focus on the object; keyboard path
(Tab, Enter, arrows, Enter on leaf); long-press on the phone viewport (pin, tap leaf, swipe close; short tap does
not pin); reduced motion (instant, no busy frames); the pixel check of 9.1.12; nav move closes the tree.
Updated: tests/e2e/room.spec.ts and room-skill.spec.ts where a click on an object expected the skill view (they
click OPEN, or use the direct-open shortcut if Q2 adds one).

Harness: extend scripts/room-v35-wire.mjs (or a new room-holo.mjs) with `stills | crisp | ac | perf`.

## 10 Open questions and risks

- Q1 Labels as engine marks (recommended, 5.1) or DOM text in Silkscreen?
- Q2 Muscle memory: click on an object stops opening the skill view. Keep a shortcut (double-click the object, or
  Shift+Enter) that opens the skill view directly? room.spec.ts and room-skill.spec.ts change either way.
- Q3 Shared objects with two skills (an item with `of`, e.g. a computer that carries two skills): v1 proposal: two
  centre nodes stacked 24 art px apart, each its own tree; or one centre that first splits into the skills.
- Q4 Overview: keep direct skill view there (v1), or show the tree after the descend?
- Q5 Phone sheet: the compact "holo" sheet mode (7) vs no sheet at all (tree only, OPEN on the centre node).
- Q6 Reading's category: the stills draw reading with the school ramp (slate); the build uses the real category.
- Q8 Phone Back while pinned: close the tree (needs a throwaway history entry) or leave the zone as today?
- Q7 Should "LAST 7" be one strip leaf (as drawn) or seven separate leaves (would hit the 8-leaf cap with tiers)?
- Risk: the tree over bright art (the window at sunset) needs the contrast plate, which is the least "hologram"
  part; the side rule should prefer darker free space when both sides fit (score free area minus bright area).
- Risk: hover intent and grace can feel sticky on dense walls (kitchen); tune 120 / 200 ms with Jaxon.
- Risk: feature hotspots (statue, calendar, Today) are excluded in v1, so a click on them still does the old thing:
  two behaviours in one room. They get no tree, so the difference is visible (no hologram on hover).
- Risk: dim as a number changes `ROOM.setDim`'s signature; callers pass booleans today (keep true/false working).

## 11 Build plan (later, after approval)

| File | Change |
| --- | --- |
| `engine/holo.js` (new, engine agent) | state machine, `buildTree`, layout, pixel-list cache, mark pass `addMarkPass('holo')`, motion, `busy`, `lastPassMs`; pure parts in `module.exports` |
| `engine/overlay.js` | `activate(d)` pins for skills; nameplate suppression; `div[role=tree]` mirror and hit boxes; live region text |
| `engine/input.js` | Esc order step 4-5; long-press 350 ms; click-outside closes; arrows consumed inside the tree |
| `engine/nav.js` | `at` passed through to `ui.open`; close the tree on `nav` start (or holo.js listens) |
| `engine/skill.js` | `opts.fromHolo` origin for selK / haloK |
| `engine/render.js` | `setDim(k)` numeric; register order wire -> holo |
| `ui/panel.js` | `open(id, {at, mode: 'holo'})`: tab and focus on open; phone compact sheet |
| `src/lib/data/room.ts`, `scripts/room-proto-data.ts` | `goals[].id`, `goals[].recent`, `seriesDays` |
| tests | unit room-holo, data, e2e room-holo, updates to room.spec / room-skill.spec, harness |
| `index.html`, `styles.css` | load holo.js; `.holo` styles, touch callout off |

Effort: about 3 to 4 focused days: holo.js 1.5 d, overlay/input/nav/skill hooks 0.5 d, panel `at` and phone sheet
0.5 d, data 0.25 d, tests and harness 1 d, tuning with Jaxon 0.25 d.
