# Skill tree hologram (room v3.6 spec)

Status: SPEC, revision 2 (Jaxon's review of revision 1). No engine or app code changes in this task. Plan:
`whimsical-popping-blanket` (approved), amended by the review: two sizes (small hover peek, large click tree), much
bigger textured pixel text, holo button plates with a surge, double-click shortcut, the computer's two-way split,
prominent skills at rest, the tree in the overview, reading in the mental category.

Mockups (`stills/holo/`, PIL composites over real v3.5 room frames at the room's integer zoom; every hologram pixel
is a palette colour on the art grid, see 5):

| Still | Shows |
| --- | --- |
| `stills/holo/rest-prominent-right-sunset.png` | At rest: every skill on the right wall carries its holo tag, state pip and brighter wire (6) |
| `stills/holo/gym-peek-sunset.png` | HOVER: the small peek on the squat rack (strength, athletics ramp) |
| `stills/holo/gym-open-sunset.png` | CLICK: the large tree: centre plate, branch plates with bars and today's tier, LIFT open to its leaf plates |
| `stills/holo/gym-open-night.png` | The same at night (marks stay palette-true) |
| `stills/holo/front-reading-open-sunset.png` | Reading, mental (mind ramp, PLUM), STEPS open; plates over the bright window get the denser fill |
| `stills/holo/computer-split-open-sunset.png` | The computer: one COMPUTER centre splitting left to AI BUILDING and right to DROPSHIPPING, REVENUE open |
| `stills/holo/phone-open-reading-sunset.png` | Phone 390 x 844: the large tree as a vertical stack with 44 px rows and a bottom action bar |

Frames are 1280 x 800 at zoom 2 (1 art px = 2 x 2 device px, measured: horizontal runs of 2 dominate and start on
even columns). The phone still is 1170 x 2532 (dpr 3) at 6 device px per art px. In the right-wall frames the rack
already shows its hover cage (the source frame was captured hovered). Generator (not committed):
`scratchpad/holo/mock2.py`.

---

## 1 Intent and scope

Jaxon likes the branching node tree in his reference (a glowing centre that splits into groups, then fans curved
lines to a column of leaves). The room gets its own version, in two sizes: hover a skill object and a small crisp
hologram peeks out beside it; click it and a large hologram skill tree pulls up out of the object, with real button
plates, big text and the numbers that matter, while the room dims behind it.

Decisions (binding):
- Only the branching tree. The reference's detail panel, chart, AI box and toolbar are out of scope.
- Room walls, zones and the overview. Not the admin view.
- Tree data: centre = the skill; branches = its goals, steps and metric; leaves: goal -> tiers and recent logs,
  steps -> each step, metric -> recent values by day.
- Two sizes. HOVER (or keyboard focus) = the small peek: centre node and branch nodes with counts. CLICK = the large
  tree: plates for the centre, every branch and the open branch's leaves; it may take most of the screen.
- Behaviour: a single click pins and opens the large tree; a double-click opens the skill view directly. In the
  large tree, clicking a branch opens it (accordion, one at a time); the skill view opens from OPEN SKILL on the
  centre plate, or from any leaf (at that item).
- Text: much bigger than revision 1 (5x7 pixel face at 1x and 2x), pixel-true and textured.
- Look: holographic, crisp, category colours, translucent by ordered dither, with a subtle stepped surge on plate
  outlines. Static under reduced motion.
- The computer (ai-building + dropshipping) is one centre that splits into the two skills in opposite directions.
- Every skill object is prominent at rest (holo tag, brighter wire, gentle surge), not only on hover.
- Reading is in the mental category (palette ramp `mind`: PLUM_1 / PLUM_2 / PLUM_3).
- Phone: long-press or tap pins the large tree (vertical layout); double-tap opens the skill view.

Out of scope (v1): feature hotspots (statue, calendar, Today, relic mounts, settings, review), editing from the tree,
sound, art file changes, the admin view.

## 2 Interaction model and state machine

### 2.1 States

```
idle --hover 120 ms / focus--> peek (small)
peek|idle --click / Enter / long-press / tap in a zone--> open (large, one branch open)
open --click another branch--> open (that branch; accordion)
open --OPEN SKILL / Enter on centre / leaf--> skill view (leaf: at that item)
any --double-click / Shift+Enter / double-tap on the object--> skill view (direct)
open --Esc--> collapse branch --Esc--> idle ;  open --click outside / any nav move--> idle
peek --leave object and tree box for 200 ms--> idle
```

- `idle`: the at-rest treatment (6): holo tag, brighter wire, gentle surge.
- `peek` (mouse hover after a 120 ms intent delay, or keyboard focus with no delay): the small tree (4.2). Moving
  the pointer into the peek's box keeps it; leaving both starts a 200 ms grace. A click on a peek branch opens the
  large tree with that branch open.
- `open` (large, 4.3): opened by a click on the object, Enter or Space on its focused button, a long-press, or a tap
  on the object in a zone (phone). The default open branch is today's planned goal (else the first goal, else
  steps, else metric). Clicking the open branch's plate again collapses it (all plates stay, no leaves).
- skill view: unchanged v3.5 skill place; the tree retracts as the LIFT leg starts.

State lives in `ROOM.holo` (new engine module, 11) as `{item, group, size: 'peek'|'open', branch, t0}`, mirrored to
`ROOM.state.holo` like `ROOM.state.inspect`.

### 2.2 Single click and double-click timing

The single click is never delayed. A click on a skill object opens the large tree at once (its 240 ms grow-in
starts on that frame). A second click on the same object within the platform double-click window (the browser's
`dblclick` event; 300 ms in our own touch detector) opens the skill view directly: the tree retracts in 2 x 40 ms
while the LIFT leg starts, so a double-click costs no extra wait. Because the large tree grows over the object, the
second click may land on a plate that has just appeared: for 300 ms after the opening click, a click within 6 CSS px
of the first one counts as the double-click whatever is under it. Keyboard: Shift+Enter on the object button. Touch:
two taps within 300 ms and 12 px; the hotspot buttons get `touch-action: manipulation` so the browser adds no
double-tap zoom delay to single taps.

### 2.3 Composition with ROOM.nav

The open tree is an overlay on the wall, zone or overview place, NOT a nav place: no history entry, no URL (routes
stay `/room/<zone>/<item>` for the skill view only, nav.js:112). Rules:
- Any `nav` event with `phase: 'start'` (TURN, DOLLY, RISE, DESCEND, zone steps) closes the tree instantly, the way
  wire.js resets its motion (wire.js:497-500).
- Opening the skill view: `ROOM.nav.request({mode: 'skill', item}, {source: 'holo', opener, at})`, the same call
  overlay.js makes today (overlay.js:291), with the new optional `at` (2.6). Back from that skill view lands with the
  tree closed and focus on the object button (the opener).
- Clicking another skill object while a tree is open retargets (opens that one). Clicking empty room while a tree is
  open closes it and does NOT also step into the zone (one action per click).
- Touch on a wall: today's first tap steps into the zone (overlay.js:284-289); that stays. In a zone a tap opens the
  tree (object = tree). A long-press on a wall object steps into its zone and opens the tree at landing.
- Overview: a click on an object opens the large tree over the diorama (no descend). OPEN SKILL or a leaf then runs
  today's overview path (descend to the item's wall, then the skill view: `overview.placeAt`, overview.js:137, and
  overlay.js:291 with `source: 'overview'`). Double-click in the overview opens the skill view directly, as a single
  click does today. Down or Esc closes the tree first, then leaves the overview.

### 2.4 Esc and click-outside order

Esc today (input.js:153-160): overview -> inspect -> photo -> zone/skill back. New order:

1. inspect off
2. photo off
3. large tree with a branch open: collapse the branch (focus to its plate)
4. large tree or peek: close (focus returns to the object button)
5. overview: down (unchanged, now after the tree)
6. zone or skill: `nav.back()` (unchanged)

Click outside the tree and the object closes the tree in one step. An open board or sheet still owns the keyboard
(input.js:110-117).

### 2.5 The cage, wires, tags and nameplates

- The P5 cage (wire.js:6-9) stays the object highlight on hover and focus. In the large tree the object additionally
  gets corner brackets in the category light colour and a 1 px tether line to the centre plate, so it stays tied
  to the tree under the dim.
- The tree draws in its own mark pass registered after `wire` (render.js:396-405 keeps registration order), so its
  pixels sit on top of the cage and wires.
- The at-rest holo tag (6.2) replaces the hover nameplate ("STRENGTH 52", overlay.js:166-174) for skill items.
  Features keep their nameplates. While a tree shows, its item's tag hides (the centre carries the name).

### 2.6 The skill view entry

- `activate(d)` on a skill hotspot (overlay.js:274-292) opens the large tree; `dblclick` and Shift+Enter call
  today's `nav.request` directly. Features keep their old path.
- LIFT: `ROOM.skill.lift(id, opts)` still starts the hero from the item's room rect (skill.js:424 `from =
  roomRect(h)`, the art must not jump). The tree retracts into its centre plate in 2 x 40 ms at the leg start, and
  the lift's selection light and halo (selK, haloK, skill.js:411-413) start from the centre plate's position via a
  new `opts.fromHolo = {x, y}` (device px).
- `at` (optional) reaches the board through `ROOM.ui.open(id, {opener, side, hero, at})` (ui/panel.js:133):
  `{tab: 'today'|'steps'|'data', key}`: tier leaves -> Today, that goal focused; recent log leaves -> Data, that day;
  step leaves -> Steps, that step; metric leaves -> Data, that day; "+N MORE" -> the branch's tab.

### 2.7 Keyboard

- Tab reaches object buttons in DOM order (overlay.js:301-333, unchanged); focus on a skill object peeks.
- Enter or Space on the object opens the large tree and moves focus to the centre plate; Shift+Enter opens the skill
  view directly.
- Inside the tree (roving tabindex, one tab stop): Up / Down between siblings; Right on a branch opens it and moves
  to its first leaf; Left on a leaf goes to its branch, on a branch collapses it; in the computer split, Left and
  Right on the centre move to the left or right skill; Home / End; Enter on the centre (or OPEN SKILL) opens the
  skill view; Enter on a branch toggles it; Enter on a leaf opens the skill view at that item. Tab leaves the tree
  to the next object button (the tree closes).
- Arrow keys inside the tree are consumed (`preventDefault`); input.js already returns on `e.defaultPrevented`
  (input.js:106), so the wall turn and zone walk (input.js:131-139) do not fire.

### 2.8 Screen reader

The overlay DOM mirrors the tree as an ARIA tree positioned over the drawn plates (so hit boxes and focus align):

```html
<div class="holo" role="tree" aria-label="Strength skill tree">
  <div role="treeitem" aria-level="1" aria-expanded="true" tabindex="0">
    Strength, score 52.4, level 5, Forged, athletics, 12 day streak. Open skill view
    <div role="group">
      <div role="treeitem" aria-level="2" aria-expanded="true" aria-setsize="4" aria-posinset="1">
        Lift, 5 of last 7 logged, today standard
        <div role="group">
          <div role="treeitem" aria-level="3">Standard, 45 minutes, done today</div> ...
```

- Drawn labels are short; accessible names are full words (no abbreviations, no em dashes).
- The computer split adds a level: group "Computer, 2 skills" -> skills -> branches -> leaves.
- The polite live region announces "Strength tree open, Lift expanded, 6 items" on open and on branch change. Peek
  announces nothing (focus already names the object).
- The DOM nodes are transparent hit boxes; focus is drawn as a CREAM 1 px bracket pair on the plate (pixel-true).

## 3 Data contract

### 3.1 Sources (ROOM_DATA, src/lib/data/room.ts `loadRoomData`)

Per skill (room.ts:143-178): `slug, name, category, score, display, level, levelName, streak, neglected,
lastLoggedDaysAgo, logKey, logUnit, series` (last 14 metric values, room.ts:122), `goals[]` (`name, floor, standard,
stretch, minutes, intention`, room.ts:166-175), `steps[]` (`title, points, claimed`, room.ts:176). Category names:
`categories[]` (`slug, name`). Today's goals: top-level `goals[]` (room.ts:180-190). Ramps:
`ROOM.art.palette.categories` (`mind: PLUM_1, PLUM_2, PLUM_3`; fallback ui/strip.js:24-27).

### 3.2 Additions to loadRoomData (small, additive, typed by `RoomData`)

- `skills[].goals[].id` (the non-negotiable id) and `skills[].goals[].recent`: the last 7 planned days for that goal,
  oldest first, `{day, planned: tier, tier: tier | null}` from `ctx.history` filtered by `nonNegotiableId`
  (`GoalRecord`, src/lib/data/context.ts:32-39). The last entry is today when today is planned (today's tier).
- `skills[].seriesDays`: the day of each `series` value (same order), for metric leaves and the 30-day delta.
- Reading's category in the data is mental: the seed or migration maps `reading` to the mental category (the
  palette slug `mind`). The tree takes the ramp from `skill.category`, never from a per-skill override.
- Same fields in the sample data (`scripts/room-proto-data.ts`).

### 3.3 Node shape and builder

```ts
type HoloNode = {
  id: string;                       // 'strength', 'strength/g/<goalId>', 'strength/g/<goalId>/t/floor', 'group/computer'
  kind: 'group' | 'center' | 'goal' | 'steps' | 'metric' | 'leaf';
  label: string;                    // drawn text, upper case
  name: string;                     // accessible name, full words
  value: string | null;             // count or value ('5/7', '185 LB', '$420')
  sub: string | null;               // second line: 'TODAY STANDARD', 'NEXT 225 BENCH', '+10 IN 30 DAYS', 'DONE OCT 2'
  progress: number | null;          // 0..1 for the plate bar
  segs: number | null;              // bar notches (7 days, step count)
  state: 'done' | 'open' | 'missed' | 'none';
  strip?: ('done' | 'open' | 'missed' | 'none')[];   // the LAST 7 leaf
  at?: { tab: 'today' | 'steps' | 'data'; key?: string };
  ramp: string;                     // palette category slug
  children: HoloNode[];
};
```

Pure `buildTree(item, data, today)` in engine/holo.js (exported through `module.exports` for Vitest, like nav.js).

- Centre: `label` = skill name; lines: "SCORE <score> LV <level> <LEVELNAME>" and "<CATEGORY> <streak> DAY STREAK";
  `progress` = score / 100, 10 notches.
- Goal branches (today's planned goal first): value `logged/planned` over `recent`; sub "TODAY <tier>" (or "TODAY
  OPEN", "NOT TODAY"); bar = logged / 7 with 7 notches. Leaves: FLOOR, STANDARD, STRETCH with minutes and state
  (`done` when today's result reached that tier, `open` when it is today's planned tier and unlogged, else `none`),
  one LAST 7 leaf (7 state pips), then the latest 2 logs as dated leaves ("MON NOV 9 / STANDARD", "SUN NOV 8 /
  MISSED").
- Steps branch (when `steps.length`): value `claimed/total`; sub "NEXT <first open step>"; leaves = each step
  ("DONE OCT 2" or progress text or "OPEN").
- Metric branch (when `logKey`): label from the unit (BENCH, PAGES, REVENUE), value = latest with unit; sub = the
  change over 30 days; leaves = last up to 7 values newest first with their days.
- Caps: 6 branches (extra goals fold into "+N GOALS"), 8 leaves per branch (7 + "+N MORE").
- Empty skill: the centre plate alone with OPEN SKILL.

### 3.4 Groups (the computer)

A group is two or more skill items that read as one object. v1 data: an optional `group: 'computer'` on the items
in the manifest (`computer.board` dropshipping and `computer.ai` ai-building, both in zone `computer`); no
inference. `buildTree` for a grouped item returns a `group` node (label "COMPUTER", sub "2 SKILLS <CATEGORY>")
whose children are the skills' centre nodes. Hovering or clicking either item opens the group tree with that
item's skill on its natural side (4.4); the accordion is global (one branch open across both skills).

## 4 Layout

All geometry is in art px of the current view (buffer coordinates `f.x0/f.y0` like overlay.js:160-170), rounded to
whole art px, so it is pixel-true at any integer zoom. Recomputed on open, branch change, resize, zoom and data
change; cached in between.

### 4.1 Common

- Anchor: the item's hit box at rest (`cssRectOf`, render.js:1616-1626; the box `ROOM.itemRectCss` returns,
  render.js:1599-1613).
- Margins: below the HUD strip + 4 art px; clear of the turn chevrons (20 art px each side), the zone dots and the
  "D CONTROLS" chip (bottom 16 art px).
- Text: the 5x7 face (overlay.js F5, extended with digits and `/ . : - + > $ %`), advance 6 art px per glyph at 1x,
  4 for a space; 2x doubles every glyph pixel.

### 4.2 Small peek (hover)

As revision 1, with bigger text: centre disc r 7 with the level inside; branch nodes r 3 on an arc
(`y_i = cy + (i - (n - 1) / 2) * 20`, `x_i = cx + s * sqrt(46^2 - (0.6 * (y_i - cy))^2)`); labels "LIFT 5/7" in the
5x7 face at 1x beside the nodes; title above the centre. Side = the side with more free width; ties go right. Box
about 150 x 90 art px (at 1280: 300 x 180 CSS, 23 % wide). No plates (it must stay light).

### 4.3 Large tree (click)

Left-to-right fan (s = -1 mirrors it when the object sits in the right third and the left has the room):

| Part | Size (art px) | Text |
| --- | --- | --- |
| Centre plate | width = longest line + 12 (min 150), height 74 | name 5x7 at 2x; two 1x lines; score bar; OPEN SKILL button plate (17 high) |
| Branch plates | 136 x 38, stacked 47 apart, 30 right of the centre | name at 2x (1x when over 9 chars); value at 1x right aligned; sub line 1x; bar |
| Leaf plates | 200 x 15, stacked 19 apart (22 on touch), 34 right of the branches | state pip 5 x 5; label 1x; value and date or state right aligned |
| Lines | 1 px | trunk: centre right edge to each branch (quadratic); leaves fan from the open branch's right edge |

Placement: the box (about 580 x 300 art px with 6 leaves) is placed so the centre plate is as close to the object as
the margins allow; it may cover the object, which keeps its brackets and tether (2.5). Vertically the leaf column
centres on the open branch, clamped to the margins; branches centre on the centre plate.

Per breakpoint (zoom = device px per art px, as the room reports it; CSS = art px x z / dpr):

| Viewport | zoom (check) | Art viewport | Large tree | Text cap height 1x / 2x | Leaf row target |
| --- | --- | --- | --- | --- | --- |
| 1280 x 800 | 2 | 640 x 400 | ~580 x 300 (90 % x 75 %) | 14 / 28 CSS | 38 CSS |
| 1440 x 900 | 2 | 720 x 450 | ~580 x 300 (80 % x 67 %) | 14 / 28 CSS | 38 CSS |
| 1920 x 1080 | 3 | 640 x 360 | ~580 x 300 (90 % x 83 %); 5 leaves max before "+N MORE" | 21 / 42 CSS | 57 CSS |
| phone 390 x 844, dpr 3 | 6 (2 CSS per art px) | 195 x 422 | vertical stack (7) | 14 / 28 CSS | 44 CSS |

When the box does not fit (short viewports), leaves drop to 5 + "+N MORE", then branch plates drop the sub line
(height 28), then the whole tree scales nothing: text never shrinks below 1x.

### 4.4 The computer split

Group plate top centre above the object (COMPUTER at 2x, "2 SKILLS BUSINESS"), tethered to the object. Each skill
gets its own skill plate (2x name, score line, value line, "OPEN >") going in opposite directions: the skill whose
item sits left (or lower) goes left, the other right; each skill's branch plates stack under its skill plate. The
open branch fans its leaf plates inward into the column between the two skills (`computer-split-open-sunset.png`),
so both directions stay readable. Box about 560 x 260 art px.

### 4.5 Collisions

The box stays inside the margins: first the leaf column moves vertically, then the whole tree shifts away from the
edge, then the reductions of 4.3. The tree never covers the HUD strip or chevrons. Pointer hits inside the tree box
go to the tree while it is open; the room's other hotspots stay reachable by keyboard.

## 5 Rendering

### 5.1 Where it draws

An engine mark pass, `ROOM.render.addMarkPass('holo', pass)` (render.js:396-405), registered after `wire`; mark
passes run after drawItems and before weather (render.js:773-775). Pixels are written like
`ROOM.render.plotMark(f, x, y, c, depth, flags)` (render.js:379-392): palette index, aux depth 254 (in front of
everything, like the fx trail at fx.js:407-414), flags `16 | 128` (engine mark, no rim) and `1 | 16 | 128`
(emissive, like the LED pixels at fx.js:157) for outlines, corner ticks, surges, bar tops and text top edges. For
the large tree's volume (8.1) a batch writer `ROOM.render.plotMarks(f, list)` writes a cached typed list with the
same semantics. The GPU lights marks like the art but never below 70 % of their palette colour (wire.js:12-13); the
Canvas2D path shows them palette-true. Labels are marks too (pixel-true under the GL upscale and dim); the DOM
carries only the ARIA tree and hit boxes.

### 5.2 Holo ramp

Five steps per category: deep, dark, mid, light, hi = the category ramp `[dark, mid, light]` plus its palette
neighbours:

| Category | deep | dark | mid | light | hi |
| --- | --- | --- | --- | --- | --- |
| athletics | TERRA_VD | TERRA_0 | CRT_0 | CRT_1 | CREAM |
| business | OAK_DK | TERRA_1 | AMBER | GLOW | SUN |
| school | SLATE_D | SLATE_0 | SLATE_1 | SLATE_2 | SLATE_3 |
| mind (mental) | PLUM_0 | PLUM_1 | PLUM_2 | PLUM_3 | PLUM_4 |
| nutrition | LEAF_0 | LEAF_1 | LEAF_2 | LEAF_3 | LEAF_4 |
| gold (fallback) | GOLD_DK | GOLD_MID | GOLD | GOLD_HI | SUN |

Plus INK and CREAM. Only palette colours; no alpha anywhere ("translucent" = ordered dither, the art shows through).

### 5.3 Text (big, crisp, textured)

5x7 face at integer scale k (1 or 2; 3 allowed for the phone centre name), every glyph pixel a k x k block of art px:
- Lighter top edge: a glyph pixel with no glyph pixel above it takes the top colour (CREAM).
- Scanline: other glyph pixels on odd art rows take the shade colour (one step down), even rows the base colour.
  At 2x each glyph pixel spans two art rows, so every big stroke has a bright row and a shaded row: never flat.
- Outline: INK on the 8 neighbours, plus one `deep` row under the outline (a 1 px drop that gives depth).
- Tones: title = CREAM / CREAM / hi; body = CREAM / hi / light; accent = hi / light / mid; dim (collapsed) =
  light / mid / mid.
- Contrast floor: label core vs its surround >= 4.5:1 for 1x text, >= 3:1 for 2x, measured on the lit frame. The
  plate fill (5.4) carries this; INK outline is the fallback where text sits off a plate.

### 5.4 Holo plates (buttons)

| Part | Pixels |
| --- | --- |
| Fill | even rows: INK where Bayer 4x4 < 8, `deep` at 8..10; odd rows: INK < 5, `dark` at 5 (about 69 % / 37 % cover: translucent with a scanline) |
| Lighter top edge | first inner row: `mid` (active) or `dark` (collapsed) where Bayer < 8 |
| Outline | 1 px `light` (active) or `mid` (collapsed); bottom edge one step darker |
| Corner ticks | 3 px L in CREAM on each corner (`light` when collapsed) and one outer tick pixel 2 px off each corner |
| Bar | 3 rows: top row `hi`, then `light` for the filled part; empty part `dark` checker; INK notch per segment |
| State pip | 5 x 5 rounded: done = `light` with a `hi` top; open = `light` ring; missed = `dark` ring, INK centre; none = one `mid` px |
| Contrast floor | over bright art (mean luma of the dimmed frame under the plate > 70 of 255) the fill thresholds scale x1.5 (the window plates in the reading still) |

Bigger pixels (zoom 3 and up, the phone): the recipe is per art px, so the dither, scanline and edges scale with
the art and stay as textured as the room itself; no smoothing, no sub-pixel detail.

### 5.5 Lines

1 art px pixel-perfect curves (no L corners). Idle trunks `mid`; hot lines (to the open branch, leaf fans, tether)
a `light` core plus a sparse `dark` halo on the perpendicular neighbours (Bayer < 6, even rows only).

### 5.6 Dim, night, rain, glow

- Dim: peek 12 % (new numeric `ROOM.setDim(0.12)`, render.js:1591-1594 takes a number; `true` keeps meaning the
  board dim). Large tree: the board dim (`ROOM.setDim(true)`, the skill view's ~40 % level). Marks keep their colour
  (the dim skips bit4 pixels).
- Night: no change; palette-true with the 70 % floor (`gym-open-night.png`).
- Rain draws after mark passes (render.js:775) and crosses the tree like any in-room light. Photo mode hides trees
  and tags.
- Glow: only the existing bloom on emissive mark pixels, which gl.js caps for marks (gl.js:512) and keeps grain off
  (gl.js:515). No new GPU pass, texture or shader flag.

## 6 At rest: every skill prominent

Built on the v3.5 wires (wire.js REST table, wire.js:33-40):

### 6.1 Brighter rest wire

- One ramp step up for every rest state: off GOLD_MID -> GOLD; pending GOLD -> GOLD_HI (node GOLD_HI -> SUN); top
  GOLD / SUN unchanged (it breathes); half GOLD_HI; full GOLD_HI / CREAM; neglect SLATE_1 -> SLATE_2.
- A sparse outer halo: GOLD_DK at Bayer < 4 on even rows, one px outside the INK keyline, on every rest wire (not
  for neglected skills).
- Contrast re-measured with the wire AC harness (room-v35-wire.mjs ac): >= 3:1 on every wall, day and night.

### 6.2 Holo tag

A small plate (the 5.4 recipe, 13 art px high) per skill item: state pip (today: done, open, missed, none) and the
skill name in the 5x7 face at 1x, CREAM title tone, in the skill's ramp; neglected skills use the slate ramp and no
surge. Placed 5 art px above the item's hit box, centred; below the box when its top edge lies inside another
skill's box (AI BUILDING under the monitors); de-overlapped greedily upward like the nameplates (overlay.js:175).
A dotted 1 px `mid` tether (even rows) joins tag and wire. Tags show on walls and zones; hidden in the overview
(items too small), in photo mode, and for the item whose tree shows. Phone: tags in zone view only; walls show the
pip alone. Tags are not separate targets: they share the item's hotspot button (the button's box grows to include
the tag).

### 6.3 Gentle surge at rest

One 6 px bright segment runs once around each tag outline every 6 s, items staggered by 0.75 s; one 4 px GOLD_HI
segment runs along each rest wire once every 8 s. Stepped (80 ms per step), never on neglected skills, none under
reduced motion. No bob (moving text by 1 art px reads as jitter).

## 7 Motion

All steps run on `ROOM.now()` and request frames only while busy, like wire.js `busy()` (wire.js:479-484).

| Event | Timeline |
| --- | --- |
| Peek in | f0 centre disc; f1..f4 (4 x 40 ms) trunks drawn 25 % of their pixel path per frame; f4 branch nodes with one pulse (CREAM ring 80 ms); labels in 2 Bayer steps. ~240 ms |
| Large open (pull-up) | f0..f1 centre plate grows out of the object's top edge (outline first, then fill in 2 Bayer steps); f2..f5 trunks and branch plates (outline, then fill, then text); f5..f8 leaf fans and leaf plates top to bottom, one per 40 ms. ~360 ms; a single click shows the first frame at once |
| Flicker | once on open: halo and fill pixels drop for one 40 ms frame |
| Branch change | old leaves retract 2 x 40 ms, new leaves fan 4 x 40 ms |
| Plate surge | per plate, a 6 px segment (light, hi, CREAM, CREAM, hi, light) laps the outline clockwise in 20 steps of 80 ms (1.6 s), then rests 3.2 s; plates offset by 0.4 s; the open branch plate and OPEN SKILL surge, collapsed plates do not |
| Retract (Esc, outside, nav start, skill view) | 2 x 40 ms back into the centre plate; nav start: instant |
| At rest | 6.3 |

Reduced motion (`prefers-reduced-motion` or `?motion=0`, core.js:193-199): every change instant and complete, no
flicker, no pulse, no surge (plates and tags static); the 120 ms hover intent and 300 ms double-click window stay
(they are input timing, not motion).

## 8 Performance budget

### 8.1 Budgets

- Peek mark pass < 0.3 ms per frame (headless Chromium, SwiftShader, 1280 x 800).
- Large tree mark pass < 0.5 ms: about 25,000 to 30,000 art px (plate fills at ~50 % cover, text, outlines) written
  from a cached typed list by `plotMarks` (one tight loop over `Uint32Array` pairs of buffer index and palette
  index + flags). The surge rewrites at most 6 px per plate on top of the cached list.
- Tags and brighter wires at rest: < 0.15 ms per frame added to the wire pass.
- No extra GPU passes, textures or uniforms. `buildTree` + layout < 1 ms on open or branch change.
- Frames: the room already renders live rest frames (motes, weather, the top-priority breath); surges ride those.
  When nothing else animates, the surge steps request at most 12.5 frames per second, and stop while the tab is
  hidden. Measured as `ROOM.holo.lastPassMs`.

## 9 Phone

- Long-press 350 ms on a skill object opens the large tree (on a wall: steps into the zone, opens at landing);
  movement over 8 px cancels (it is a pan). Haptic-free. `.hs` buttons: `-webkit-touch-callout: none`,
  `user-select: none`, `touch-action: manipulation`, `contextmenu` prevented.
- Tap on a skill object in a zone opens the large tree; double-tap opens the skill view directly.
- Layout (`phone-open-reading-sunset.png`): a vertical stack over the dimmed room: the centre plate across the width
  (name at 2x, two 1x lines, bar); the branch plates as a row of chips (up to 3 per row, 26 art px high); the open
  branch's leaves as full-width 22 art px rows (44 CSS), each with label and value on two lines; a bottom action bar
  (INK, like the sheet chrome) with OPEN SKILL VIEW (44 CSS high) and the hint "DOUBLE TAP OPENS IT DIRECTLY".
  The object keeps its brackets behind the dim.
- Close: tap empty room or swipe down on the bar. Android Back: the tree has no history entry, so Back runs nav's
  popstate move (nav.js:682); the build pushes a throwaway entry while the tree is open on the phone (Q3).

## 10 Acceptance criteria and tests

### 10.1 Acceptance (measurable)

1. Hover >= 120 ms shows the small peek; < 120 ms shows nothing; focus shows it at once.
2. A single click shows the first frame of the large tree in the same frame as the click (no delay); open completes
   in <= 380 ms; reduced motion: complete in the same frame.
3. A double-click (or Shift+Enter, or double-tap) opens the skill view; the second click of a double-click never
   lands as a plate click.
4. OPEN SKILL and every leaf open the skill view at the right tab and item.
5. At most one branch open; at most 6 branches and 8 leaves (5 at 1920 x 1080).
6. Every tree, tag and wire pixel is a palette colour on the art grid (crisp harness: zero non-palette colours in
   the tree box on Canvas2D; on GL every z x z block inside the tree is uniform).
7. Text: 1x cap height >= 14 CSS px at 1280; 2x titles >= 28 CSS px; 1x contrast >= 4.5:1, 2x >= 3:1.
8. Large tree inside the margins at 1280, 1440, 1920 and phone; never over the HUD strip or chevrons.
9. Targets: >= 24 CSS px on fine pointers (leaf rows 38 CSS at 1280), >= 44 on touch.
10. Esc order as 2.4; focus returns to the object after close and to the opener after the skill view.
11. Screen reader: role tree, levels, expanded state, set size and position; full-word names; the computer group
    level present.
12. Computer: hovering or clicking either item shows one COMPUTER centre with both skills on opposite sides.
13. At rest: every active skill on the current wall shows its tag and the brighter wire; wire contrast >= 3:1.
14. Peek < 0.3 ms, large < 0.5 ms, rest additions < 0.15 ms (SwiftShader); no new GPU passes.
15. No art pixel changes outside the tree box and tag boxes: the palette index buffer with trees and tags on equals
    the buffer with them off everywhere else (the dim is GPU-side and does not touch indices).
16. Overview: a click opens the tree over the diorama; OPEN SKILL descends and opens the skill view.

### 10.2 Tests

Unit (Vitest, tests/unit/room-holo.test.ts): `buildTree` (branch order, values, subs, bars, tier and strip states,
caps, empty skill, groups, mental ramp for reading); layout (peek arc, large placement, mirror rule, margins,
reductions per breakpoint, split sides, all coordinates integers); text raster (texture rules, widths); plate raster
(contrast floor switch); click and double-click detector (single click immediate, 300 ms window, 6 px radius).

Data: `goals[].id`, `goals[].recent` (<= 7, oldest first, today's tier), `seriesDays` length equals `series`,
reading's category is mental.

e2e (Playwright, tests/e2e/room-holo.spec.ts with room-helpers.ts): hover peek; click opens the large tree; accordion;
double-click opens the skill view; Esc order; click outside; leaf opens the skill view at the item; OPEN SKILL;
Back returns with the tree closed and focus on the object; keyboard path (Tab, Enter, arrows, Shift+Enter); computer
split from either item; overview click; at-rest tags present and not overlapping; phone (tap and long-press open,
double-tap opens the skill view, short tap on a wall steps into the zone, swipe close); reduced motion (instant, no
busy frames); the pixel check of 10.1.15. Updated: tests/e2e/room.spec.ts, room-skill.spec.ts and
room-overview.spec.ts where a click on an object expected the skill view (they double-click, or click OPEN SKILL).

Harness: a new scripts/room-holo.mjs (`stills | crisp | ac | perf`) next to room-v35-wire.mjs.

## 11 Open questions and risks

- Q1 The large tree may cover the object it came from (the gym still). Keep the brackets and tether as the link, or
  always keep the object uncovered and accept a smaller tree on crowded walls?
- Q2 Tags replace the hover nameplates for skills. Do features (statue, calendar, Today) also get tags, or stay as
  they are in v1?
- Q3 Phone Back while the tree is open: close the tree (needs a throwaway history entry) or leave the zone as today?
- Q4 Should the at-rest surge run on every skill, or only on skills with an open goal today (calmer room, clearer
  signal)?
- Q5 The computer's group is explicit in the manifest (`group: 'computer'`). Are there other pairs that should share
  a centre (gym running + triathlon)?
- Risk: a busy wall at rest (six tags on the right wall) reads as UI rather than room; the still keeps them small
  (13 art px) and the rest surge rare. Tune with Jaxon on the real build.
- Risk: double-click relies on the second click not being eaten by the growing tree; the 6 px / 300 ms rule covers
  it and is unit tested.
- Risk: the large tree volume (25,000+ px) is the most expensive mark pass so far; the batch writer is required, not
  optional.
- Risk: `ROOM.setDim` becomes numeric; boolean callers keep working.

## 12 Build plan (later, after approval)

| File | Change |
| --- | --- |
| `engine/holo.js` (new) | state machine, click and double-click detector, `buildTree`, groups, peek and large layout, text and plate rasters, cached lists, mark pass, motion and surge, `busy`, `lastPassMs`; pure parts in `module.exports` |
| `engine/wire.js` | brighter REST table, outer halo, rest surge along wires, tags (or tags in holo.js with a shared raster) |
| `engine/overlay.js` | `activate(d)` opens the tree for skills; `dblclick` shortcut; tag-aware button boxes; nameplates off for skills; ARIA tree mirror; live region text |
| `engine/input.js` | Esc order; Shift+Enter; long-press and double-tap; click outside; arrows consumed inside the tree |
| `engine/nav.js` | `at` passed to `ui.open`; tree closes on nav start; overview path from the tree |
| `engine/overview.js` | click opens the tree instead of descending; OPEN SKILL descends |
| `engine/skill.js` | `opts.fromHolo` origin for selK / haloK |
| `engine/render.js` | `setDim(k)` numeric; `plotMarks` batch writer; pass order wire -> holo |
| `ui/panel.js` | `open(id, {at})`: tab and focus on open |
| art manifest | `group: 'computer'` on `computer.board` and `computer.ai` |
| `src/lib/data/room.ts`, `scripts/room-proto-data.ts`, seed | `goals[].id`, `goals[].recent`, `seriesDays`; reading -> mental |
| tests | unit room-holo, data, e2e room-holo, updates to room / room-skill / room-overview specs, harness |
| `index.html`, `styles.css` | load holo.js; `.holo` and `.hs` touch styles |

Effort: about 5 to 6 focused days: holo.js 2.5 d (rasters, layouts, split), rest treatment 0.5 d, hooks (overlay,
input, nav, overview, skill) 1 d, panel and data 0.5 d, tests and harness 1 d, tuning with Jaxon 0.5 d.

## Decisions, review round 3 (Jaxon, 2026-11-11; to fold into the sections above)
1. The main object is never covered. Opening the big tree moves the object to the centre of the tree with visible
   illumination; the hologram tree gets a subtle energizing effect and is sized and attached to fit each object.
2. Features also get at-rest tags; the statue's tag reads FORGE.
3. The at-rest surge runs only on skills with a goal open today.
4. Paired skills share a centre like the computer (e.g. running and triathlon).
5. Android Back closes an open tree.
6. Categories: academics is mind; ai-building and dropshipping are business.
7. Next step: a general mockup of how the hologram pulls up, from inspiration images Jaxon will upload. No build yet.
