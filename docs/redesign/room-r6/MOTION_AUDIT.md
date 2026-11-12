# FORGE room v3.5: motion audit (before and after)

What Jaxon asked: "do a quick audit on the movement mechanics when switching between views and clean everything up,
as well as the lighting consistency when you click into an item". This page lists every finding of the v3.5 audit
(understand phase U1 motion, U2 lighting, U6 visual) with the numbers before and after the v3.5 navigation rewrite
(package P1, `engine/nav.js` + the move renderer in `engine/render.js`).

How the numbers were taken: `scripts/room-motion-audit.mjs` (headless Chromium, SwiftShader WebGL2, 1280x800, frozen
clock stepped 16 ms, sunset `el=4 p=85`, `gltier=high`, clear weather unless noted). A "pop" is the mean absolute RGB
difference between two consecutive frames (160x100 thumbnails). The rest-frame noise floor (film grain, dust) is
measured on 10 frames before each move: about 2 on the GPU path, about 0 on `gl=off`. A pop above noise + 2 on a
frame where nothing should change is visible. Before = the v3.4 engine (W0 base); after = v3.5 P1 with P2's gl.js
(the pairing the integration will ship). Raw output: `audit.json` per run in the v3.5 scratch area.

## 1. Headline: the lighting pop on every step into or out of a zone is gone

| Move (GPU, el 4) | before: start / landing pop | after: start / landing pop | noise |
|---|---|---|---|
| wall -> zone (library) | **25.7 / 27.5** | 0.00 / 2.10 | 2.2 |
| zone -> wall | **29.3 / 28.5** | 0.00 / 2.17 | 2.1 |
| zone -> zone, same wall | **29.3 / 33.4** | 0.00 / 2.44 | 2.1 |
| turn, adjacent wall | 0.00 / 2.10 | 0.00 / 2.14 | 2.2 |
| turn, opposite wall | 0.00 / 2.38 | 0.00 / 2.16 | 2.1 |
| wall -> zone on another wall | 0.00 / 2.82 | 0.00 / 2.15 | 2.1 |
| zone -> zone across walls | 0.00 / 3.71 | 0.00 / 2.74 | 2.3 |
| click item on this wall (lift into the skill view) | (zone dolly + spotlight + instant dim) | 0.00 / 0.63, largest frame step 4.9 | 2.4 |
| close the skill view (drop) | instant undim | 0.00 / 0.38, largest step 3.7 | 1.9 |
| item to item on the same wall (swap) | n/a | 0.00 / 0.00 | 1.9 |
| click item on another wall (turn + lift) | n/a | 0.00 / 0.36 | 2.2 |

Same moves at night-ish sun (`el=-25`), in rain, and on the Canvas2D path (`gl=off`):

| Move | el -25 before -> after (landing) | rain before -> after | gl=off before -> after |
|---|---|---|---|
| wall -> zone | 18.9 -> 2.96 | 27.7 -> 2.55 | 0.41 -> 0.18 |
| zone -> wall | 24.0 -> 2.83 | 33.0 -> 2.88 | 0.40 -> 0.09 |
| zone -> zone | 27.5 -> 2.82 | 36.4 -> 4.11 | 0.16 -> 0.10 |
| turns | 3.0 / 3.0 -> 3.0 / 3.2 | 2.1 / 2.1 -> 2.1 / 2.4 | 0.15 / 0.02 -> 0.11 / 0.02 |
| zone -> zone across walls | 4.6 -> 3.8 | 3.7 -> 2.8 | 2.07 -> 0.27 |

Every start pop is 0 and every landing pop is within noise + 2 on every path (worst: zone -> zone in rain, 4.11
against a noise floor of 2.40). Before, every dolly popped by 19 to 36.

Why: the dolly used to be drawn from unlit sprites plus the old Canvas2D light while the room at rest is lit by the
GPU, so the room jumped warm-brown at the start of every step in and back at the landing. Now every frame of every
move is made of real rest renders (the same lighting pass, GPU or Canvas2D) scaled by whole pixels: the first frame is
the frame on screen, the last is the destination's real rest frame, and lighting changes in between are 4x4 pixel
stipple (Bayer) dissolves, never alpha fades.

## 2. Every finding, before and after

| # | Finding (source) | Before | After |
|---|---|---|---|
| 1 | GPU dolly lighting pop at start and landing (U1 3.1, U2 F1/F2) | 25.7 to 33.4 per dolly | 0 start, landing within noise (section 1) |
| 2 | A zone's darkening baked into turns out of the zone (U1 3.2) | end pop 12.3 to 14.1 | each wall master carries its own light state: the leaving zone's focus pans away with its wall; landing 2.15 to 2.74 |
| 3 | Arrival effects already "half done" during turns into a zone (U1 3.3) | end pop 2.9 / 3.6 | the destination is drawn with its arrival light at full; nothing ramps after landing (landing 2.15) |
| 4 | Double image (120 ms framing dissolve) at the start of zone-changing turns (U1 3.4) | 7 to 15 per frame for 9 frames | TURN+ZOOM: zoom and centre move with the yaw; start pop 0 |
| 5 | The dolly dropped weather, outlines, lamp pools, motes, nameplates and zone dim (U1 3.5) | all vanished for 450 ms | moves are drawn from full rest renders (everything kept, animation frozen for the move) |
| 6 | Opening a board dimmed the room in one frame and dimmed the clicked item 20 to 30 % (U1 3.6, U3 1.7) | GPU 47.4 -> 37.7 luma in one frame | the dim is a float tween (240 ms, 16 steps on Canvas2D); the item itself is lifted out undimmed by the skill view (P3) |
| 7 | Panels opened after Esc, Back or a chevron during a move (U1 3.7, E3 E4 E5 E7) | panel of the abandoned item opened | one rule: a superseded move never runs its landing; Esc during a step-in reverses it in place (e2e test) |
| 8 | Inconsistent input during moves: turns dropped presses, zone moves snapped with a 25.7 jump (E1, E2, E9) | drop vs snap | one policy: same target ignored, back to the start reverses, extra turn presses retarget the turn (up to three walls), anything else queues one slot; canvas clicks during a move are ignored |
| 9 | History entries for interrupted moves; `turn({push:false})` still pushed (U1 3.8) | 3 entries for 3 quick keys | one entry per move (retargets and reversals replace it); closing a skill view pops its own entry; e2e: three Right presses = one entry |
| 10 | Mixed clocks (real setTimeout for the panel, wall clock for the title) | panel opened on wall time under a frozen clock | every navigation timer (moves, tweens, the board at landing) runs on the engine clock (`ROOM.now()`); only the cosmetic zone-title reveal keeps its own frame clock |
| 11 | Hover outline kept after a move | until the mouse moved | hover cleared at move start |
| 12 | Turn end crossfade over a still-moving image (ghost) | alpha crossfade 160 ms | the exact last frame is re-projected with the same yaw and dissolved in by stipple, then drawn as is at the end |
| 13 | Statue downlight stayed after closing the statue (E15) | stayed in the room view | the downlight belongs to the statue's skill place light state; it goes with the place |
| 14 | Wheel and pointer-cancel snapped to other walls' zones; title named other walls' zones (E12) | snapped to 336 in the right view | all use the current wall's zones |
| 15 | Territory gaps fell to the last zone (U1 3.10) | tap at x 130 on the right wall went to the gym | nearest territory wins (unit test) |
| 16 | Phone pan spring ignored reduced motion (E14) | 12 frames of spring | lands at once |
| 17 | A turn from a panned phone position landed with a ghost (E13) | last diffs 5.8 / 5.0 | the turn starts from the frame on screen (exact) |
| 18 | Turn masters 22 to 88 MP (U1 3.9) | iPhone room master 22 MP, laptop zone master 88 MP | every snapshot at a zoom dividing the end zoom within 6 MP and the GPU texture limit; largest seen 4.8 MP at 1280x800; screen-size shots: 2880x1800 = 5.2 MP at 1440x900@2, 1170x2532 = 3.0 MP at 390x844@3 |
| 19 | Six lighting steps on the clicked object in 1.2 s (U2 F2) | bookshelf L* 16.5 -> 23.3 -> 15.4 -> 22.1 -> 20.1 -> 12.9 | no spotlight, no dolly relight: the object's L* changes only by the board dim tween, in steps of at most 0.7 L* (GPU) / 0.8 L* (Canvas2D) per frame, monotone down on open and up on close (with the skill view the item itself is lifted out lit instead, P3) |
| 20 | Lighting depending on framing: light cap, hover evicting a lamp, vignette/bloom/bounce, focus singleton, mid-session tier change (U2 F7 to F11) | | P2's gl.js (explicit dim and focus k, 16 + 4 light slots, tier changes only when the navigator is idle); the navigator owns every tween |
| 21 | Two zone darkenings stacked (Canvas2D DIM rect and GPU ellipse) | both on the GPU path | one per path: GPU ellipse, or DIM in 16 stipple steps on Canvas2D |
| 22 | Zone dots live under an open board; STATS "Open calendar" left the board open during the turn (U3 6.12) | | dots sit under the board's scrim; any move that leaves a board open (STATS "Open calendar", leaving a skill view) closes it first |
| 23 | Debug info had two `view` keys | | one `view` plus `nav` |
| 24 to 28 | Dead code: three-view and 'main' branches, dithered lamp pools, per-layer dolly, layer canvases, restA/restB, duplicated stop/zone variants, spotlight pulse | present | deleted (synthetic fallback relics kept: only the fallback art uses them) |
| 29 | Stale comments and help text ("keys 1 to 7", "Left/Right next zone", "three views") | | rewritten; help sheet lists Up, Down, L; canvas label patch sent to the page owner |

Visual findings from U6 that were about motion (the dolly's warm flash, the arrival spotlight, the double image) are
items 1, 4 and 19 above.

## 3. What changed for the user

- Stepping into and out of a zone keeps the room's light: no warm flash, no dark landing.
- Turning between walls still pans (640 ms, 900 ms to the opposite wall); turning into a zone on another wall now
  zooms during the pan instead of starting with a double image.
- The dolly moves the room as one lit plane (the old small depth parallax between layers is gone); frame crops at the
  edges dissolve away instead of sliding off.
- Up opens the overview (once its art is in), Down or Esc comes back; clicking an item never moves the camera when it
  is on the wall you face.
- Quick key presses during a move are handled the same way everywhere (section 2, item 8).
- Reduced motion: every move is instant, including the phone pan spring.

## 4. Known remaining

- Inside a turn the wall masters and the exact end frame differ slightly (the masters cover the whole wall at a lower
  zoom); the stipple dissolve over the last 200 ms spreads that difference: the largest frame step in the last frames
  of a turn is 7 to 13 on the GPU path (well under the 49 of normal pan motion), not a pop at the landing.
- RISE / DESCEND into the overview are implemented and exercised against a synthetic overview; their numbers are taken
  at integration once the overview art (P4) is in.
- Lift/drop/swap numbers above use the W0 skill-view stub (no hero yet); P3's hero adds its own lift.

## 5. Display-rate pass (v3.5 motion pass, frame-timing harness)

How: `scripts/room-frame-timing.mjs [out] [query] [--phone] [--only=a,b]` (headless Chromium, SwiftShader WebGL2,
1280x800@1 or 390x844@2, el 4, clock frozen and stepped 16.7 ms). Per frame it records the camera pose of the running
leg (zoom, centre, pan angle; `ROOM.nav.leg.pose`), the hero rect, the phone pan x, the pixel change and the wall
cost of the frame. "acc" is the largest frame-to-frame change of screen speed (device px per frame, lower is
smoother; a jump from rest to full speed on the first frame shows here), "start pop" the pixel change of the first
frame (noise about 2), "stalls"/"jumps" frames that stop or leap against their neighbours, "req" the main-thread
cost of the request call (snapshot builds) before the first frame. Before = b5d8873, after = c9eef9d.

| Move | frames before -> after | acc before -> after | start pop before -> after | stalls+jumps before -> after |
|---|---|---|---|---|
| turn 90 | 38 -> 38 | 6.7 -> 6.7 | 0 -> 0 | 0 -> 0 |
| turn 180 | 53 -> 53 | 6.9 -> 6.9 | 0 -> 0 | 0 -> 0 |
| turn into a zone (TURN+ZOOM) | 38 -> 50 | 21.2 -> 12.8 | 0 -> 0 | 0 -> 0 |
| zone to zone across walls | 38 -> 47 | 32.7 -> 22.3 | 0 -> 0 | 0 -> 0 |
| zone to zone, same wall (dolly) | 26 -> 33 | 8.7 (first frame 119 px) -> 14.9 | **42.3** -> 0 | 0 -> 0 |
| room to zone (dolly) | 31 -> 34 | **92.7** -> 14.8 | **12.9** -> 0 | 1 -> 0 |
| zone to room (dolly) | 26 -> 34 | 8.4 (first frame 115 px) -> 14.1 | **38.1** -> 0 | 0 -> 0 |
| rise / descend | 31 / 31 | 10.8 / 8.9 (unchanged) | 0 / 0 | 0 |
| lift (skill view), hero | 21 -> 21 | **94.6** -> 42.2 | 1.6 -> 1.0 | 0 -> 0 |
| drop, hero | 16 -> 16 | **107** -> 57.1 | 0.7 -> 2.2 | 1 -> 0 |
| lift on another wall (turn + lift), hero | 60 -> 60 | 83.0 -> 28.5 | 0 -> 0 | 3 -> 0 |
| hologram open, hero | 21 -> 21 | 62.3 -> 47.0 | 1.1 -> 0.7 | 1 -> 0 |
| hologram close, hero | 37 -> 37 | 78.1 -> 49.8 | 1.1 -> 0.7 | 2 -> 2 (the hold before the drop) |
| lift reversed mid-way, hero | 19 -> 19 | 143 -> 72.7 | 1.6 -> 1.0 | 1 -> 1 (the turn-around) |
| turn, two more presses (retarget) | 119 -> 119 | 4.1 -> 4.1 | 0 -> 0 | 0 -> 0 |
| turn, then a queued zone | 70 -> 70 | **75.0** -> 14.2 | 0 -> 0 | 3 -> 0 |
| dolly reversed mid-way | 23 -> 23 | **92.7** -> 14.8 | 12.9 -> 0 | 2 -> 0 |
| phone: into a zone / out | 31 / 26 -> 36 / 22 | 115 / 3.1 -> 16.3 / 11.2 | **12.2 / 16.2** -> 0 / 0 | 1 -> 0 |
| phone: turns | unchanged | 13.4 / 13.9 | 0 | 0 |

What was rough and why:
- Every dolly (room <-> zone, zone <-> zone) started at full speed: easeOutCubic has its largest speed at u = 0, so
  the first frame jumped 115 to 119 device px (pixel pop 38 to 42, the largest pop of any move). Stepping in from a
  wall also ran an 80 ms pull-back first, which read as a stall followed by that jump (acc 93). Now: one curve that
  starts and ends at rest (cubic run-up over 35 %, cubic settle, speed continuous), no pull-back, and a length that
  follows the screen distance (380 to 680 ms; a zone step is about 520 ms).
- The hero's lift had the same full-speed start (94 px on frame 1) and the drop hit the socket at full speed (107 px
  on the last frame). Both curves now start and land at rest; the integer zoom steps follow the eased flight instead
  of the clock, so the hero no longer keeps growing after it has nearly stopped.
- Turns that also zoom (into a zone on another wall, zone to zone across walls) did a 1.5x to 2x zoom in the same
  640 ms as a plain turn (peak 216 px per frame); they now get up to 200 ms more.
- A move's clock started before its shots were built. Building them costs 100 to 400 ms of main thread in SwiftShader
  (the request call; one to three wall masters plus the destination shot), so with a live clock the first drawn
  frame was already that far into the move: a visible skip, and on a slow machine a whole 640 ms turn could land
  before the next key press was read. That is the root cause of the "three Rights are one move" e2e flake (the
  second press found the first turn landed and started a second move with its own history entry). A camera leg's
  clock now starts when its planning is done.
- Frames sampled moves at `performance.now()` inside the callback (jitter of whatever ran first); they now sample at
  the rAF timestamp, one time for the whole frame (`ROOM.clock.frame`), and the pan spring advances by the real dt
  (exact solution, up to 4 dropped frames made up) instead of being capped at 50 ms (it slowed down on a dropped frame).
- Phone fling: a fast fling toward a near stop overshot it and swung back (critical damping overshoots when the
  speed toward the target exceeds w x distance). The spring now stiffens just enough for that release, keeping the
  release speed (no velocity jump).

Not changed (measured fine or by design): turn yaw curves and retargets (velocity-matched Hermite, acc 4.1 over 119
frames), rise/descend, stipple dissolves (no frame showed pixel change without camera motion beyond noise + 1.5:
flicker count 0 on every move), reduced motion (every move still instant). Remaining: the request-call cost itself
(100 to 400 ms in SwiftShader; masters are pre-warmed for neighbour walls on idle outside tests) still delays the
first frame on slow machines, but no longer skips motion; the hero's stepped halo (3 Bayer steps) and the in-place
rise on the phone (4 steps) are deliberate pixel-art steps.
