# FORGE spec v2: design and dashboard

Status: for review with the mockup (2026-10-17). Supersedes these sections of the original spec: 1 (mobile first),
4.1 (dashboard), 5.3 (figure rendering), 9.2 (calendar colour), 11 (visual design system). Everything else
(scoring, goal engine, streak, reviews, integrations, copy rules) stands. Audit of the current app:
`docs/redesign/AUDIT.md`. Mockup: `docs/redesign/mockup/` (published privately at https://claude.ai/artifact/Jo9xm45881VhMeZqzbDvjf). This spec as a page: https://claude.ai/artifact/KcinSKueRWKZbe1PoWsqQ8. Statue layers are rebuilt with `node scripts/figure-layers.mjs <tier-v.png> <out-dir>`.

## 1. The idea

**Every logged goal becomes light travelling down a tube into the statue, and that is the only light in
the room.**

The room is dark and still. Nothing glows unless it was earned. The statue is obsidian; effort fills its
cracks with gold, the way kintsugi mends a broken bowl, so a break is repaired in the open, never hidden.
That is the stoic reading, and it is also the rule that keeps the design honest: light is information.

Competitor test: Whoop, Oura and Apple Fitness show rings and charts. Only FORGE has a statue you light
and repair. Remove the statue and this could be any dashboard; keep it at the centre and everything else
supports it.

### Rules that follow from the idea
1. **Light is earned.** Glow appears only on the figure, its veins and its tubes. Nothing else glows: not
   cards, not text, not buttons, not the background.
2. **Gold means you.** Gold marks the overall score, the tier, the veins and days at 85% or more. Never a
   button, an icon, a heading or decoration.
3. **Colour means a category.** The five category colours appear only on data: tubes, chart marks, check
   fills, the bar on a schedule item. Interface chrome is navy, bone and grey.
4. **Stillness at rest.** The page does not move by itself. Motion answers an action (a pulse, a pour, a
   crack, a tier-up) and then stops.
5. **No guilt.** Misses are absence of light, never red alarms. Red appears only as Athletics' colour.

## 2. How the content is organized

The layout follows the dichotomy of control. It is shown by placement, never by labels.

| Zone | Question it answers | Modules |
| --- | --- | --- |
| Right rail | What is in my control today? | Today checklist, due soon, today's schedule |
| Centre | What does it add up to? | Score strip, the figure with five category tubes, trends |
| Below | What is the record? | Completion calendar, bottle archive, activity log |

On a laptop all three zones share the first screen: the strip, the figure and the start of the Today
list are visible without scrolling. The record is one scroll down.

## 3. References and what was taken

Two AI-generated service dashboards (HomeService, ServiceFlow), used as strong inspiration.

| From | Taken | Left out |
| --- | --- | --- |
| HomeService | Sidebar, KPI strip, one lit centrepiece with tubes, right rail, analytics row, table; glow concentrated in one place | Search bar, avatars, map, stars, invented numbers |
| ServiceFlow | KPI card with a corner sparkline, ring with bars beneath, schedule list with time and a coloured bar, lit top edge on cards, bottom dock on phone | Ambient violet glow, glow on every edge, close buttons on every card, emoji greeting |

The single most important lesson from the pair: HomeService looks calm and ServiceFlow looks busy for one
reason. HomeService keeps its light in the centrepiece. FORGE does the same with the figure.

## 4. Layout

### 4.1 Desktop, 1440 wide (primary)

```
┌──────────┬───────────────────────────────────────────────────────────────────────────┐
│ FORGE    │ Thursday, Oct 15 · Class heavy      Win the morning                        │
│          ├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐          │
│ Dashboard│ Overall  │ Today    │ Streak   │ 7 days   │ Sleep    │ Weight   │          │
│ Business │ 26 II    │ ◔ 57%    │ 4 · 12   │ +5.7     │ 7.4 h ~~ │ 184 ~~   │          │
│ School   ├──────────┴──────────┴──────────┴──────────┼──────────┴──────────┴──────────┤
│ Mind     │                                            │ Today            4 of 7 done  │
│ Athletics│   Business ──╮                 ╭── School  │ ▢ Store work         40 min   │
│ Nutrition│               ╲      ◯       ╱            │ ▢ Training session   75 min   │
│          │      Mind ─────── [ statue ] ──── Athletics│ ...                           │
│ Overall  │               ╱              ╲            ├───────────────────────────────┤
│ Review   │   Nutrition ─╯                            │ Due soon                       │
│ Settings │                                            │ MATH 1210 Problem set 6  30 h │
│          │                                            ├───────────────────────────────┤
│ Log      │                                            │ Today's schedule               │
│ number   │                                            │ 9:00 MATH 1210 ...             │
│          ├──────────────┬──────────┬──────────────────┼───────────────────────────────┤
│          │ Score trend  │ Today by │ Completion,      │ Training       │ Numbers       │
│          │ (area)       │ category │ 30 days (bars)   │ miles + lifts  │ chess, store  │
│          ├──────────────┴──────────┴──────────────────┴────────────────┴───────────────┤
│ account  │ Calendar (month)          │ Archive (bottles by category)                   │
│          ├───────────────────────────┴─────────────────────────────────────────────────┤
│          │ Activity                                                                    │
└──────────┴─────────────────────────────────────────────────────────────────────────────┘
```

- Grid: sidebar 232px; content area 12 columns, 16px gaps, 24px outer margins.
- Score strip: six equal cards, 104px tall.
- Figure stage: 8 columns by about 560px. Right rail: 4 columns, sticky below the strip, its own scroll
  when Today is long.
- Analytics row: 5 cards (3, 2, 3, 2, 2 columns), 248px tall.
- Record: calendar 5 columns, archive 7 columns; activity table full width.
- Tile sizes are limited to these four families (strip card, rail card, chart card, wide card), so the
  board fits edge to edge with one gap value (taste-skill, the well-kept board).

### 4.2 Desktop, 1280 wide
Sidebar collapses to a 72px rail: icon above a short label, 44px targets, active item marked with the tube
motif (a 3px rounded bar). Grid otherwise unchanged; analytics row wraps the numbers card under training.

### 4.3 Tablet, 768
Two columns. Strip becomes 3 by 2. Figure full width (420px tall), then the rail modules in two columns,
then analytics in pairs. Sidebar becomes a top bar with a menu.

### 4.4 Phone, 390 (calm)
One column; order chosen so logging takes under 30 seconds:
1. Header: score and tier on the left, today ring and streak on the right.
2. Today checklist (the first thing below the header, no scrolling needed for the rack).
3. Figure, 360px tall, tubes shortened to stubs from the region edge.
4. Due soon, then today's schedule.
5. Score strip as a two-column list of numbers with sparklines.
6. Charts reduced to sparklines with their current value; tap opens the full chart sheet.
7. Calendar, archive, activity.
8. Bottom tab bar: Home, Skills, Review, Settings (44px targets, safe-area padding).

## 5. Modules

Every module: title in sentence case at 14px, one primary figure, and its states.

| Module | Shows | Data source (existing) | Empty state | Tap |
| --- | --- | --- | --- | --- |
| Overall | Score (56px gold, light weight), tier numeral and name, 7-day change | `loadDashboard().overall` | n/a | `/overall` |
| Today | Completion % with small ring, done of planned | `todayP`, goals | "No plan yet" | scroll to Today |
| Streak | Current and best | `streak` | "Starts at 85%" | calendar |
| 7 days | Overall change vs a week ago, with arrow | `overall.trendDelta` | "Builds over a week" | `/overall` |
| Sleep | 14-night average hours, sparkline | `sleepSessions` via `nights()` | "Log tonight" | `/s/sleep` |
| Weight | Latest bodyweight, sparkline | metrics `bodyweight_lb` | "Log a weigh-in" | `/s/strength` |
| Figure | Statue at its tier; five category nodes with score and lowest skill; tubes lit by category score | `categories`, `overall.tier` | statue at tier I | node opens category |
| Today checklist | Rack, balance, stretch goals; tap logs, long-press tiers, swipe swaps | goals (unchanged logic) | "No goals today" | logs |
| Due soon | Assignments due in 7 days, 48-hour items marked | `assignments` | "Nothing due this week" | `/s/academics` |
| Today's schedule | Classes, training slot, key dates, as time and bar rows | schedule days, key dates | "Add class times in Settings" | Settings |
| Score trend | Overall score, 30 / 90 days, area | `score_snapshots` overall | "Builds one point a day" | `/overall` |
| Today by category | Donut of today's goals by category with counts | today goals | "No plan yet" | none |
| Completion, 30 days | Daily completion bars, 85% reference line | `daily_completions` | "Builds one bar a day" | calendar day |
| Training | Weekly run miles (bars), bench and squat top sets with sparklines | metrics `run_mi` (new), `bench_1rm`, `squat_1rm` | "Log a run" | `/s/running` |
| Numbers | Chess rating and store revenue, each with sparkline | metrics `chess_rating`, `revenue_week_usd` | "Connect or log" | skill page |
| Calendar | Month of completion cells | `daily_completions` | future days neutral | day detail sheet |
| Archive | Bottles by category, filters | skills | n/a | skill page |
| Activity | Newest 12: goal logs, numbers, milestones, notes | new feed query | "Your log starts with today" | row opens skill |

Review prompts (Sunday, first Sunday) sit at the top of the right rail when due.

## 5a. Editing and logging (crucial: it has to be effortless)

The dashboard is where you act, so nothing should send you to another page to change a goal or record a
number. Every edit and every log happens in place, and every one can be undone.

### Editing a goal's wording
- **Where:** in the Today list. On a laptop, double-click the goal's text, or focus the row and press E.
  On the phone, long-press opens the goal sheet, which now starts with an Edit row.
- **What you can change:** the goal's title and its Floor, Standard and Stretch wording and minutes, in
  one compact form inside the row (laptop) or the sheet (phone). The form is filled with the current
  wording, focused on the field you tapped, and saves on Enter or on blur.
- **Scope, asked once in the form:** "Today only" or "From now on". Today only changes this plan's copy
  (`plan_goals.title` and `text`). From now on also updates the daily goal (`non_negotiables`), so future
  plans use it; today's row updates too if it has not been logged.
- **Category plates and skill names** are renamed the same way from the plate's menu; the skill page keeps
  its full editor for everything else (days, intention, budget).

### Logging progress
- **Done in one tap** stays the default: tap the circle, the goal logs at its planned tier, the pulse runs.
- **Partial progress:** a goal with a measurable target (minutes, grams, miles, pages) shows a small progress
  tube under its text. Drag it, tap a preset (Floor, Standard, Stretch), or type a number. The tier is
  worked out from the value against the goal's targets: 25 of 40 minutes is Floor, 40 is Standard, 60 is
  Stretch. Goals without a number keep the three tier buttons.
- **Numbers on the dashboard:** every number card is also its input. Click the weight card, type 184.2,
  press Enter; the sparkline extends with the new point. Same for sleep (bed and wake taps), chess rating,
  store revenue, a run's miles, and a top set.
- **Quick log is a journal, saved to Mind** (decided 2026-10-17). A Journal button (the centre of the
  phone's tab bar; the sidebar on a laptop; or press L) opens a small sheet: a rotating stoic prompt ("What
  is in your control right now?", "What did you do well today?"), one free-text entry, and an optional
  "Head right now" choice: Heavy, Strained, Steady, Clear, Locked in. Save files it under Mind, adds a row
  to Activity, and sends a small pulse up the Mind tube. Numbers are not typed here; they go in their cards.
  The Journal card on the dashboard shows the latest entries; the Mind category page keeps the full log.
- **Undo:** every log and edit shows one quiet line for 6 seconds, "Logged Store work at Standard. Undo".
  Undo restores the previous value exactly.
- **The 30-second rule** still holds: a full day of goals is one tap each, and any number is one click,
  the value, and Enter.

### Data this needs (build phase 3)
- `non_negotiables`: optional `unit` and numeric targets per tier (`floor_target`, `standard_target`,
  `stretch_target`); minutes already exist and become the default target when the unit is minutes.
- `plan_goals`: `progress_value` for partial logs, and today-only title and text edits (columns exist).
- New `journal_entries` table (user, day by the 4 AM rule, created_at, body up to 1,000 characters, optional
  `head` 1 to 5), owner-only RLS like every other table; shown on the dashboard and the Mind page, included
  in the export.

## 6. Visual system

### 6.1 Colour tokens

```css
:root {
  color-scheme: dark;
  --ground: #070a12;        /* navy-black: 70 to 90% of every screen */
  --surface: #0e1422;       /* cards: one tone step up */
  --raised: #141b2d;        /* hover, inputs, the open sheet */
  --edge: rgba(170, 190, 255, 0.14); /* the 1px lit top edge, cards only */
  --ink: #e6e9f0;           /* cool bone; never pure white */
  --muted: #8c95a8;         /* secondary text; 6.1:1 on --surface */
  --gold: #d4af37;          /* score, tier, veins, 85% days */
  --cat-business: #c8850e;  /* tuned from #e8a33d */
  --cat-school: #4676f2;    /* tuned from #4a7bf7 */
  --cat-athletics: #e3464b; /* tuned from #e5484d */
  --cat-mind: #a966e5;      /* tuned from #a77bff, nudged toward orchid */
  --cat-nutrition: #00a75d; /* tuned from #2fbf71 */
}
```

- Category colours keep their hues; lightness is moved into the dark-mode band (OKLCH L 0.48 to 0.67) and
  Mind is nudged toward orchid. Validated with the dataviz checker on `--surface`: lightness, chroma,
  colour-blind separation and contrast all pass for adjacent pairs.
- **Fixed chart order: Business, School, Athletics, Mind, Nutrition.** School blue and Mind violet are
  too close to sit next to each other (they fail when compared directly), so they are never adjacent, and
  every category mark carries a direct label. The mockup shows original and tuned colours side by side.
- Contrast (computed): ink on ground 16.3:1, ink on surface 15.1:1, muted on surface 6.1:1, muted on raised 5.7:1, gold on surface 8.7:1.

### 6.2 Type
- **Inter** for everything, tabular numerals on every number (`font-variant-numeric: tabular-nums`).
- Five sizes: 12 (meta), 14 (interface), 16 (reading), 28 (card figures), 56 (overall score).
- Numbers at 28 and 56 in weight 300 to 400; tracking -0.02em at 28, -0.035em at 56. Light weights read
  strong on dark.
- Titles in sentence case at 14px weight 500. No uppercase tracked labels, no eyebrows.
- **Variant A:** Fraunces for tier names ("Forged") and identity lines only. **Variant B:** Inter only.
  Recommendation after the mockup: see section 12.

### 6.3 Surfaces and shape
- Card: `--surface` fill, 1px `--edge` on the top only, radius 14px, padding 20px. No backdrop blur, no
  drop shadow, no outline. Nested panels are not allowed.
- Chips and buttons: fully round, neutral fill (`--raised`), ink text. The only filled light control is a
  checked goal, filled with its category colour.
- The motif: the tube, a rounded stroke with a soft elbow. At small scale it is the progress bar, the
  schedule item's left bar, the active nav marker and the line in charts.

### 6.4 Focus and states
- Focus: 2px `--ink` ring with 2px offset on `:focus-visible`, everywhere (the app has none today).
- Hover raises the surface one step (`--raised`); press scales to 0.98 for 140ms.

## 7. The figure

### 7.1 Assets
Generated with Higgsfield (Nano Banana Pro, 2k, 4 credits): a tier I statue (obsidian, front view, cool
blue rim light, flat navy-black background) and a tier V edit of it with gold kintsugi seams. The two
renders differ in reflections by about 12% of lit pixels, so all three layers are cut from tier V alone,
which makes them line up exactly:

| Layer | How it is made | Size |
| --- | --- | --- |
| `statue-base.webp` | Tier V with the gold painted out (floating-point normalized convolution over a slightly widened gold mask); faint dark seams remain, the cracks before they are filled | 38 KB |
| `statue-veins.webp` | Tier V's gold pixels with alpha from the gold mask | 37 KB |
| `statue-bloom.png` | The gold mask blurred wide in floating point, gold, with a clean floor so it never tints the background | 150 KB |

The stage background is the image's own background colour (`#0d1018`), so the picture has no edge.

### 7.2 How tiers and categories light it

- **Tier:** veins grow outward from the heart. An elliptical mask centred at the heart (47%, 30% of the
  image) opens with the tier: I 0%, II 30%, III 58%, IV 92%, V everything. Gold
  spreading from the centre is the repair happening.
- **Category:** the vein layer is clipped into seven polygons (head; left arm; right arm; chest; core;
  left leg; right leg) assigned to the five regions (head: Mind; left arm: Business; right arm: School;
  core and left leg: Athletics; chest and right leg: Nutrition, matching `categories.region`). Each piece's
  opacity is 0.55 plus 0.45 times its category score.
- **Aura:** a soft gold radial behind the statue, opacity by tier, drawn in CSS (static).
- **Tubes:** from each category node to its region on the statue, a 2px bright core over an 8px soft stroke
  in the category colour, opacity by category score. No SVG blur filters.
- **Tier-up:** the radial mask opens to the new tier over 1.6s while the veins brighten; existing sound.

### 7.3 Fallback
Until the images load, or if they fail, the current drawn SVG figure renders with the new palette.
The three layers total about 225 KB at 805 by 1200; a 2x set can follow if they look soft on a retina
laptop.

## 8. Charts

Rules from the dataviz skill, applied:
- Score trend: area with a 2px line, gold (it is the score), recessive grid, crosshair tooltip.
- Today by category: donut with 2px gaps between segments, direct labels with counts, total in the centre.
- Completion, 30 days: bars in the completion ramp, 4px rounded tops, 85% reference line in gold.
- Training: weekly miles as bars in Athletics; lifts as sparklines with the current top set.
- Sparklines: 2px line, no axes, last point marked, value beside it in ink.
- One axis per chart, never dual. Values and labels in ink or muted, never in the series colour.
- Every chart has a hover tooltip and a table view for screen readers.

### 8.1 Completion colour (replaces spec 9.2)
Red-to-green read as guilt and passed through muddy olive. Completion is now one cool hue that brightens
with effort (decided 2026-10-17), and a gold line wraps each run of streak days: the line encloses
consecutive days at 85% or more, opening where the run continues into the next cell, so a streak reads as
one gold-bordered shape across the week:

| Completion | 1 to 24% | 25 to 49% | 50 to 69% | 70 to 84% | 85% and up |
| --- | --- | --- | --- | --- | --- |
| Fill | `#385573` | `#44698f` | `#5b90c7` | `#79b0e8` | `#afd5fe` |
| Day number | ink | ink | ground | ground | ground |

No plan and future days stay `--surface`; 0% on a planned day is `--raised` (stone, unlit). The ramp
passes the ordinal checks (single hue, even lightness steps, light end clears the surface).

## 9. Motion and sound

| Moment | Motion | Sound |
| --- | --- | --- |
| Goal checked: **the power-up** | A bead of light in the category colour accelerates down its tube (520ms). On impact: gold surges through the veins from the entry point (an expanding clip over a full-brightness vein and bloom layer, 1.1s); comic speed lines burst behind the statue and fade (620ms); the halftone field flashes; the statue takes the hit, a 1.8% pump upward (520ms); a comic caption pops at the region, black on bone with a hard offset shadow in the category colour ("Strength +0.6"). Then the region settles brighter, because its score went up | tink, pitch rising with each goal that day |
| Bottle fills | Existing pour | pour |
| Streak breaks | Existing crack, then the seam fills gold over 1.2s | crack |
| Tier up | Full splash: the vein reach opens to the new tier over 1.6s, a long speed-line burst, the statue pumps 3%, a large comic caption "Tier III: Forged" | three rising tinks, then the bell |
| Hover, press | Surface step 180ms; press 0.98 for 140ms | none |

At rest nothing moves. The power-up is loud on purpose (Jaxon: "like something out of a comic book, this
guy is getting pumped with the gold veins of truth"), and it is earned: it only happens when you act. All of
it is transform, opacity and clip on pre-baked layers; there are no live blur filters. With reduced motion:
no travel, no speed lines, no pump; the veins brighten once instead.
Hover a goal or a plate (laptop): every other tube dims and that category's tube and veins light up, so you
see what the goal feeds before you log it.

## 10. Copy
All rules stand: no em dashes, direct, no hype, no guilt, sentence case, `Intl` dates ("Oct 15", never
"2026-10-15"), loading labels end with an ellipsis ("Saving…"). Module titles are plain nouns: Today,
Due soon, Schedule, Score trend, Completion, Training, Numbers, Calendar, Archive, Activity.

## 11. Performance and accessibility budget
- Mid-range phone: 60fps scroll. No `backdrop-filter`, no animated SVG filters, animate transform and
  opacity only. Figure images under 250KB each at phone size.
- 44px targets everywhere; axe has no serious findings; every chart has a text alternative.
- Desktop first paint shows the strip, figure and Today without layout shift (reserved image sizes).

## 12. Pack reconciliation

| Source says | FORGE does | Why |
| --- | --- | --- |
| taste-skill: no glass, glow, lit edges, violet; not for dashboards | Glow on figure and tubes only; cards opaque with a 1px top edge; violet only as Mind's data colour; taste laws used, its page process not | Jaxon's references and restraint rules; the idea needs light |
| taste-skill: no tracked uppercase labels, no eyebrows | Adopted | Generated-page tell, and the audit found them everywhere |
| web-interface-guidelines: Title Case buttons | Sentence case | FORGE copy rules |
| web-interface-guidelines: focus rings, `Intl` dates, `name` and `autocomplete`, ellipsis | Adopted | Audit findings |
| redesign-skill: grain, gradients, coloured shadows | Not adopted | Depth from tone steps; light is reserved for the figure |
| dataviz: fixed categorical order, validated palette, one axis | Adopted with the order in 6.1 | Blue and violet must not be adjacent |
| References: sparklines everywhere, avatars, invented metrics | Sparklines only on sleep, weight, chess, store, lifts; no avatars; sample numbers labelled in the mockup | Real data only |

**Fraunces:** decided in review from the mockup's A and B toggle. Recommendation: B (Inter only) for the
HUD look, with Fraunces kept for the tier name on the figure only if A wins.

## 13. Data needed for the build
All from one `loadHub` composer over `loadUserContext` (`src/lib/data/context.ts`), reusing
`loadDashboard`, `trackerFor`, `nights`, `loadHistory` and `buildWeek`:
- New metric `run_mi` (per run) so weekly miles can be charted; `long_run_mi` stays for milestones.
- Activity feed: plan goal completions, metrics, milestone claims and skill logs, newest first, 12 rows.
- Schedule rows: classes from the schedule template (needs CMPS and ARCH times), training slot, key dates.
- Score snapshots for 90 days, completions for 30 days (both already stored).

## 14. Build phases after approval (stop after each)
1. Tokens, fonts, base components, focus styles.
2. App shell: sidebar, rail at 1280, top bar at 768, tab bar at 390.
3. `loadHub`, the `run_mi` metric, the activity feed, goal targets and progress, today-only edits, quick-log matcher and undo (with tests).
4. Dashboard modules and charts; the new figure with vein layer, tubes and pulse.
5. Secondary pages restyled; ISO dates replaced; inputs named.
6. Motion and accessibility pass; e2e selectors updated; 30-second logging test still passes.
