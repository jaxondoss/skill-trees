# FORGE spec v2: design and dashboard

Status: revision 2 (2026-10-17, approved direction: "replace the mockup"). Supersedes these sections of the
original spec: 1 (mobile first), 4.1 (dashboard), 4.3 (skill page layout), 5.3 (figure rendering), 9.2
(calendar colour), 11 (visual design system), 12 (starting content for new users). Everything else (scoring,
goal engine, streak, reviews, integrations, copy rules) stands.

- Mockup: `docs/redesign/mockup/` (private page: https://claude.ai/artifact/Jo9xm45881VhMeZqzbDvjf). Its
  Mockup controls switch between a sample month and a fresh start, and set the background and power-up.
- Design guidelines: `docs/DESIGN-GUIDELINES.md`, tokens in `docs/design-system/tokens.json` (Design System
  page: https://claude.ai/artifact/AwWt7i26HqFSFxhmRZUfcQ).
- Audit of the old app: `docs/redesign/AUDIT.md`. Statue layers: `node scripts/figure-layers.mjs <tier-v.png> <out-dir>`.

## 1. The idea

**Every logged goal becomes light travelling into the statue.** The room is a dark circuit board that
breathes; the widgets float above it like instruments; the statue is obsidian and effort fills its cracks
with gold, the way kintsugi mends a bowl in the open. Light is information: the brightest things on the
screen are always the things you earned.

### Rules that follow
1. **Light is earned.** The statue, its veins and the power-up are the only things that shine at full
   strength. The field and the tile edges carry low, ambient light (under 10% opacity) so the board has depth
   without competing.
2. **Gold means you.** Overall score, tier, veins, kept days (85% or more), reached steps, and personal
   records. Never a button, an icon or a heading.
3. **Colour means a category.** The five category colours mark data and the tiles that belong to a category
   (corner glow, bottom bar, icon, status line, chart marks, its primary button). Chrome stays neutral.
4. **Motion answers you.** At rest only the field moves (slow breathing, sparse data pulses). Everything else
   moves because you did something, then stops.
5. **No guilt.** Misses are absence of light. Red is only Athletics' colour.

## 2. Reference and what was taken

Third reference (2026-10-17), a dark smart-home widget board, is now the format: "the sharpness, the fonts,
the gradients and the method of widgets". Taken: violet-black ground, small heavy titles over muted secondary
text, uppercase tracked section labels with a hairline, corner-glow gradients, a 3px progress bar at the
bottom of each tile, tinted icon tiles, rings, a floating dock. Left out: emoji 3D icons (Lucide line icons
instead), device-control toggles. Jaxon's additions in review: "depth in the squares", "a smooth electronic
background that pulses slightly", "dynamic lighting". The two earlier service dashboards still give the
structure (one lit centrepiece, a control column, a record below).

## 3. Layout

### 3.1 Laptop, 1280 and up (primary)

```
FORGE  07:50  Saturday 17 October  Weekend                       [Streak 6] [Today 57%] [Journal L]
┌──────────── THE STATUE ────────────┬──────── TODAY ─────────┬──── ring: today, streak ──┐
│ 44.2  III Forged  Next tier at 60  │ RACK  ○ Store work 25/40│ NEXT UP  schedule rows     │
│                    [statue]        │ BALANCE ...             │ DUE SOON  Canvas rows      │
│ Business ▬▬▬ 47 ... Nutrition 36   │ [Add a goal for today…] │                            │
└────────────────────────────────────┴─────────────────────────┴────────────────────────────┘
SKILLS ───────────────────────────────────────────── 14 active
[15 skill tiles, 5 across, in category order]
NUMBERS ──────────────────────────────────────────── Tap to log
[6 readout tiles: bodyweight, sleep, chess, revenue, miles, reading rate]
RECORD ─────────────────────────────────────────────
[calendar 4] [score or completion trend 5] [journal 3]
[activity, full width, two columns]
                              ( dock: Overview, five categories | Journal, Review, Settings )
```

- 12 columns, 12px gap, max width 1480, 24px side margins. Hero 5 columns by 2 rows, Today 4 by 2, the right
  column 3 by 2 (all stretch to the same height).
- Section headers: uppercase label, then a hairline to the edge, optional mono meta at the end.

### 3.2 1024 to 1279
Hero 7 and Today 5; the right column becomes a row of three. Skills and numbers 3 across. Dock icons only.

### 3.3 Phone, under 640
One column. Today comes first, then the hero (420px tall), then the right column, skills and numbers two
across, the record. The dock becomes a solid bottom tab bar (Overview, Journal, Review, Settings) with 44px
targets and safe-area padding. Minute counts in Today rows hide to keep goal text readable.

## 4. The board, module by module

| Module | Shows | Data | Empty state |
| --- | --- | --- | --- |
| Statue hero | Overall score (64px gold), tier, next tier, five category rows with score and bar, the statue at its tier with veins lit by category | `loadDashboard().overall`, `categories` | Statue at tier I, all rows 0 |
| Today | Rack, Balance, Stretch groups; tap logs, timed goals get a minutes slider, pencil edits in place; an add field with a skill picker | plan goals (goal engine unchanged) | "Nothing planned for today", add field |
| Ring | Today's completion ring, streak (gold), best | `todayP`, `streak` | 0% and 0 days |
| Next up | Today's classes, training slot and key dates as time rows with a category bar; a now marker | schedule days, key dates | "Add class times in Settings" |
| Due soon | Assignments due in 7 days; under 48 h marked in School's text colour | `assignments` | "Nothing due this week" |
| Skill tiles | Icon, score, name, "Rack, 1 goal, 2 of 5 steps", today's status line, bottom bar | skills, goals, milestones | "Empty to-do list / Add your first goal" |
| Number tiles | Value in mono with a sparkline; the tile is its own input (click, type, Enter) | metrics, sleep sessions | "-" and "Tap to log the first one" |
| Calendar | Month in the completion ramp, gold outline around each kept run | `daily_completions` | Neutral cells |
| Trend | Overall score (gold area) or completion bars, toggled | `score_snapshots`, completions | One-line hint |
| Journal | Latest three entries with mood | `journal_entries` (new) | "No entries yet" |
| Activity | Newest 8: goal logs, numbers, step claims, journal | feed query (new) | One-line hint |

Hovering a goal, a skill tile, a number or a category row lights that category's region on the statue
and dims the rest, so you see what an action feeds before you take it.

## 5. The skill page

Order, top to bottom (answering "each skill has a precise visualization below"):

1. **Header tile:** back to Overview, category label (plus "on the rack" or "dormant"), the name at 34px,
   the identity line editable in place (placeholder "Write who you are becoming in Strength."), counts
   (goals, steps done, level from steps) and the score ring. Dormant skills show a Wake button.
2. **To do:** two tiles side by side.
   - **Goals** (`non_negotiables`): repeating tasks. Each row: log circle, title, days ("Daily", "Weekdays",
     "Tue Thu Sat"), the day's wording, tier chip, minutes, pencil. Tap the row to fill in the details:
     title, what the task involves (note), Floor, Standard and Stretch wording with minutes, the days it
     repeats, delete. Add field at the bottom; a new goal opens its details straight away.
   - **Steps** (`milestones`): one-time milestones. Each row: claim circle, title, note, points. Details:
     title, details, an optional "done when" rule, size Small 5, Medium 10 or Large 20 points, delete.
3. **The numbers:** one tile, full width, with the skill's own visualization (section 6): a title, a
   one-sentence reading computed from the data, the chart, a legend, and the log form for that chart.
4. **Recent** (this skill's activity) and **Score, 30 days**.
5. **Manage** (pin, dormant, archive) and **Guidance** stay below, restyled.

## 6. One visualization per skill

Each is one chart with one scale, direct labels, a tooltip on every mark, a reading line above it, and an
empty state that shows the chart ghosted behind a short instruction. Category colour is the main mark;
secondary series are neutral; gold only for steps, records and race day.

| Skill | Visualization | Reading line (example) | Data | Log form |
| --- | --- | --- | --- | --- |
| AI Building | **Ship log**: 26-week grid of build sessions by minutes, ships as gold diamonds on a timeline | "4 things shipped in 26 weeks. 41 sessions in the last 8 weeks." | Build goal results (minutes by tier); metric `ship` with `meta.title` (new key) | What shipped |
| Dropshipping | **Unit economics**: weekly revenue and ad spend bars, profit after ads and product cost as a line | "$690 revenue on $260 ads, 2.7x. Profit $189." | `revenue_week_usd`, `ad_spend_week_usd`, `orders_week`; product cost share in skill config (default 35%) | Revenue, ad spend, orders |
| Academics | **Course board**: grade bar per course with the target tick, and deadlines on a 14-day line | "4 of 6 courses at target. Problem set 6 due in 30 h." | metric `course_grade` with `meta.course` and `meta.target` (new); `assignments` | Course, grade |
| Reading | **Shelf and rate**: books as spines filled by pages read, gold cap when finished; effective rate line against baseline | "2 books finished, The Lean Startup at 57%. 312 wpm, +16%." | metric `book_pages` with `meta.title` and `meta.total` (new); `books_finished`; `reading_effective_rate` | Book, pages |
| College Integration | **Your people**: radial map by where you met (classes, clubs, dorm, professors), size by conversations, distance by recency; conversations per week with office-hours dots | "11 people you know by name, 3 this week." | metric `conversation` with `meta.who` and `meta.where` (new) | Who, where |
| Time Blocking | **Plan versus day**: last 14 days, adherence bars with planned nights marked | "Planned 6 of 7 nights. Kept 78% of blocks." | `block_adherence_pct`, Plan tomorrow goal results | Tonight's adherence (0 to 100%) |
| Chess | **Rating**: rating line with the next rating step as a gold rule | "Rapid 1086, +86 in 6 weeks. 1100 is 14 away." | `chess_rating` (synced or manual); rating steps from milestones | Rating |
| Meditation | **Thirty sits**: radial clock of the last 30 days, spoke length by minutes, 10-minute ring; minutes per week | "Sat 26 of 30 days, 12 min average." | Sit goal results (minutes by tier), timer | Minutes |
| Visualization | **Vividness**: sessions rated 1 to 5 with a 7-day average, vision rewrites as gold marks | "21 of 30 days. Vividness 3.6, up from 2.8." | goal results; metric `vividness` (new); `vision_rewrites` | How vivid, 1 to 5 |
| Strength | **Lifts**: estimated one-rep max per lift, selected lift in colour, others neutral, step targets as gold rules, PRs as gold dots | "Bench 245, 20 past 225 and 10 from 255." | `bench_1rm`, `squat_1rm`, `deadlift_1rm` (new key) | Lift, weight, reps (Epley) |
| Running | **Build to January 9**: weekly miles, a suggested ramp ahead (10% a week to a peak three weeks out, then taper), long run line, race marker | "16 mi this week. 12 weeks to race day." | `run_mi` (new, per run), `long_run_mi`, race date from key dates | Miles, type |
| Sleep and Recovery | **Sleep window**: 14 nights as bars from lights out to waking, anchor tick per night | "7.2 h average. In window 9 of 14. Anchor 01:30." | `sleep_sessions` via `nights()` | Lights out, woke |
| Triathlon | **Three disciplines**: weekly minutes stacked swim, bike, run | "Dormant while Running builds to January 9." | `swim_min`, `bike_min` (new), runs | Discipline, minutes |
| Food | **Fuel**: calories against the range, protein against the target, 14 days | "Protein 10 of 14 days, calories in range 9 of 14." | meal metrics via `dailySums`, fuel targets | Calories, protein (and the photo flow) |
| Gut Health | **Habit grid**: 28 days of the daily habits, with totals | "Water 25 of 27. Fermented food is the gap, 11 of 27." | `gut_rating`, `meal_fiber_g`, metric `gut_habit` with `meta.habit` (new) | Today's habits |

## 7. Starting content: empty to-do lists

Decided 2026-10-17: goals and steps start as an empty to-do list that Jaxon fills in.

- **New users:** the seed keeps categories, skills (names, icons, regions, weights, rack) and the schedule,
  and leaves every skill with no goals (`non_negotiables`), no steps (`milestones`), no identity and no
  "100 means". The old template text is kept as **starter ideas**: up to three chips in each empty list,
  one tap adds one as an editable row.
- **The existing account** is not wiped by a migration. Settings gets "Start with empty lists", which
  deletes goals and unclaimed steps for every skill after a typed confirmation, keeps claimed steps (so
  the level never drops), and rebuilds today's plan.
- **Scoring with user-made steps:** level stays the sum of claimed points capped at 100; a step's points
  come from its size (Small 5, Medium 10, Large 20) or a number typed in the details. Consistency is
  unchanged. A skill with no goals and no steps scores 0 and its region stays dark.
- **The goal engine** already plans from whatever goals exist; with none, Today is empty and says so.

## 8. Visual system

Full rules in `docs/DESIGN-GUIDELINES.md`; the essentials:

- **Colour:** ground `#0b0b13`, surface `#15151e` (tiles at 80% over the field), raised `#1d1e29`, sunk
  `#101018`; borders white at 6% and 12%; ink `#f3f3f7`, muted `#9497a8`, label `#7f8294`. Gold `#d4af37`.
  Category trios (mark, text, tint): business `#c8850e`/`#e8a33d`, school `#4676f2`/`#6b97ff`, athletics
  `#e3464b`/`#f25f66`, mind `#a966e5`/`#b88aff`, nutrition `#00a75d`/`#2fc779`, tints at 16%. Filled
  category buttons use dark text. Fixed chart order: Business, School, Athletics, Mind, Nutrition.
- **Type:** Plus Jakarta Sans for words (titles 700 to 800, body 500), JetBrains Mono for every measured
  number. Uppercase tracked labels only for section headers and readout labels.
- **Depth:** a tile is lit from above (a 3.5% white wash over the top 40% and a 1px inner highlight), sits on
  a soft two-layer shadow, and is translucent over the field (backdrop blur 16px on laptops only). Its 1px
  edge catches the pointer: a 260px radial light follows the cursor around every nearby tile's border, and a
  faint wash follows it inside. Interactive tiles lift 2px on hover. Rows inside a tile are sunk (inset
  shadow), never nested tiles.
- **The field:** a fixed canvas behind everything: a 28px dot grid, circuit traces with 45 degree jogs,
  three slow pools of violet, blue and gold light that drift and breathe (cycles of 9 to 15 s), up to ten
  data pulses travelling the traces in category colours, and a soft light that follows the pointer. A
  power-up sends a ring of light and a burst of pulses from the statue. Modes: Live, Calm (three pulses,
  dimmer) and Still (one static frame, also forced by reduced motion). 30fps cap, pauses when the tab is
  hidden, device pixel ratio capped at 1.5.
- **Gradients:** corner glow on category tiles, the hero's rising gold light, conic rings, the progress
  bars, the field's light pools. No gradient text or buttons.

## 9. The figure

Unchanged from revision 1: three aligned layers cut from the tier V render (`statue-base.webp`,
`statue-veins.webp`, `statue-bloom.png`); the vein reach opens by tier (I 0%, II 30%, III 58%, IV 92%,
V everything) from the heart at 47%, 30%; seven region clips light by category score (opacity 0.55 + 0.45
times the score). New: the statue's edges are feathered into the hero tile with a mask, and it drifts a
few pixels against the pointer for parallax.

## 10. Motion and sound

| Moment | Motion | Sound |
| --- | --- | --- |
| Goal logged or step claimed: **the power-up** | A comet in the category colour arcs from the circle you tapped to that category's point on the statue (540ms), drawing a trail. On impact: gold surges through the veins from that point, the statue pumps, the field rings out from the statue, the skill's tile flares, the category row flashes. Comic mode adds speed lines, the halftone flash and a caption ("Business +0.6"). On a skill page the comet lands in the score ring | tink, pitch rising through the day |
| Number logged | The skill's visualization redraws, its tile flares | none |
| Tier up | Vein reach opens over 1.6s, long speed-line burst, gold ring from the statue, "Tier IV: Ascendant" caption | three rising tinks |
| Streak breaks | Existing crack, then the seam fills gold | crack |
| Hover, press | Edge light, 2px lift, 160 to 220ms; press 0.99 | none |

Reduced motion: no comet, no field motion, no pump; the veins brighten once.

## 11. Copy

All rules stand: no em dashes, direct, no hype, no guilt, sentence case, dates as "Saturday 17 October" or
"Oct 17", times 24-hour in mono rows, loading labels end with an ellipsis. Section headers are plain nouns in
uppercase: TODAY, SKILLS, NUMBERS, RECORD, TO DO, THE NUMBERS.

## 12. Performance and accessibility

- Text pairs pass 4.5:1 (label colour only on surface, sunk and ground); marks pass 3:1 on surface.
- 44px targets on touch; every icon-only button has a name; focus ring 2px ink with 2px offset.
- The field costs one canvas at 30fps; tiles animate transform and opacity only. Backdrop blur only at
  1024px and up with a hover-capable pointer.
- Every chart has an `aria-label` sentence and tooltips; the reading line states the takeaway in words.

## 13. Data needed for the build

- `journal_entries` (user, day by the 4 AM rule, created_at, body up to 1,000 characters, optional `mood`),
  owner-only RLS, included in the export.
- New metric keys (no schema change, `metrics.meta` holds the details): `ship`, `course_grade`, `book_pages`,
  `conversation`, `vividness`, `deadlift_1rm`, `run_mi`, `swim_min`, `bike_min`, `gut_habit`.
- Actions: add and delete goals; edit and delete steps; clear starter lists; journal save and delete.
- An activity feed: plan goal results, metrics, step claims and journal entries, newest first.
- Seed template: empty goals and steps for new users; starter ideas served from the template file.

## 14. Build phases (each ends green: lint, typecheck, unit, DB and e2e tests, then main)

1. Foundation: tokens, fonts, the field, tile system and pointer light, the dock, wide shell.
2. The board: statue hero with layers, Today restyle, ring, next up, due soon, skill and number tiles,
   record (calendar, trend, journal, activity).
3. The skill page: header, goals and steps to-do lists with full editing, recent, score history.
4. The fifteen visualizations with their log forms and new metric keys.
5. Starting content: empty template, starter ideas, "Start with empty lists" in Settings.
6. Secondary pages restyled (settings, review, onboarding, category, overall); e2e and axe pass.
