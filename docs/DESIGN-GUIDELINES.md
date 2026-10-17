# FORGE design guidelines: sharp widgets

Derived from reference 3 (a dark smart-home widget board). Live version with rendered components: the FORGE Design System artifact. Tokens are in `docs/design-system/tokens.json`, the widget CSS in `docs/design-system/widgets.css`, and each component preview under `docs/design-system/components/`.

This direction supersedes parts of `docs/SPEC-v2-design.md` once approved: Inter becomes Plus Jakarta Sans plus JetBrains Mono, uppercase section labels with hairlines return, corner-glow gradients are allowed on category tiles, the radius drops to 12px, and filled category buttons take dark text.

FORGE is a personal progress dashboard: a board of sharp widgets on a violet-black ground, with an obsidian statue that fills with gold as the work gets done. The board is dense and quiet; colour marks which part of your life a number belongs to, gold marks what you have earned, and the statue is the only thing that glows.

## Content fundamentals

- Write direct, plain sentences. No hype, no guilt, no exclamation marks, no emoji. "Logged Store work at Standard." "Nothing due this week."
- Address the user as "you" only when needed; most copy names the thing ("Rack, locked 3 days").
- Titles and buttons are sentence case: "Weekly review", "Log a number". Uppercase is reserved for `section-label` text: section headers ("SKILLS") and readout labels ("BODYWEIGHT").
- No em dashes anywhere. Use commas, colons or full stops.
- Numbers always carry units in the readout or right beside it: `184.2 lb`, `7.4 h`, `16 mi`. Times are 24-hour in mono rows (`17:00 to 18:00`), dates are written "Saturday 17 October".
- Loading text ends with an ellipsis: "Saving…". Errors say what to do: "Enter a number between 50 and 500."

## Visual foundations

### Ground, surfaces, edges

- Page on `ground`. Every widget is a tile on `surface` with a 1px `border` and `radius-lg`; on hover the edge becomes `border-strong`.
- Rows inside a tile sit on `sunk`; hover fills, ghost buttons and empty bar tracks use `raised`.
- Tiles never carry a drop shadow. Only the floating dock uses `dock-lift`.
- Never nest a tile inside a tile. Inside a tile, group with `sunk` rows.

### Colour

- Text is `ink` for titles and values, `ink-muted` for secondary lines, `ink-label` for uppercase labels (on `ground`, `surface` or `sunk` only).
- Each of the five categories owns one hue in three strengths: the mark (`business`), the text tint (`business-text`) and the fill tint (`business-tint`). Set the trio on a tile with the `fg-cat-<category>` class.
- A category's colour appears in exactly these places: the corner glow, the bottom bar, the icon tile, status lines and chips, readout numbers, rings, chart marks, and its primary button. Never as a tile background, never on titles.
- Filled category buttons take `on-category` text. White fails contrast on amber, green and violet.
- `gold` is reserved for the overall score, the tier, the statue's veins and kept days (85% or more). It is never a button, an icon or a heading. The active dock item's dot is the one decorative use.
- Completion uses the single-hue ramp `ramp-1` to `ramp-5`: brighter means more done. Misses are absence of light, never red. A gold outline wraps each run of kept days on the calendar.
- In charts, categories always appear in this order: Business, School, Athletics, Mind, Nutrition. School and Mind are too close to sit next to each other, and every mark carries a direct label.

### Gradients (three, and only these)

1. **Corner glow** on every category tile: a radial gradient of the category mark colour, 150px, centred 40px outside the top-right corner, at `glow-corner` opacity (`glow-hover` on hover and while that category's goal pulses).
2. **Hero light** on the statue tile: gold rising from the bottom-left (radial, 28% alpha) over a `raised` to `surface` diagonal.
3. **Rings**: a conic fill of the category mark over `raised`, the score as the arc length.

No gradient text, no gradient buttons, no gradient page backgrounds.

### Type

- Two families: `display` (Plus Jakarta Sans, from Google Fonts) for everything you read, `mono` (JetBrains Mono) for every number that is a measurement.
- Use the styles by name: `clock` for the header time, `score` for the overall score, `hero-title` for the tier, `tile-title` for every tile name, `body` for goal text and rows, `meta` for subtitles and status lines, `section-label` (uppercase, tracked 0.14em) for section headers and readout labels, `chip` for chips, `readout-lg` for readout numbers, `readout` for corner scores and ring centres, `mono-meta` for times and counts.
- Titles are bold and tight; the board's sharpness comes from 700 to 800 weights at small sizes against muted 500 secondary text.

### Spacing and layout

- The board gap is `space-3` (10px); tile padding is `space-4` (14px); sections are `space-6` apart.
- Laptop (1280 and up): a 12-column board with 24px gutters. Top row: the hero statue tile (5 columns, two rows tall), the Today list (4), the overall ring (3) above the completion ring (3). Then SKILLS (15 skill tiles, 6 across), RACK (5 rack cards), NUMBERS (6 readout tiles), RECORD (calendar and activity), and the dock floating at the bottom centre.
- Tablet: 6 columns, skills 3 across. Phone: 2 columns, skills 2 across; the Today list comes first under the header; the dock becomes a bottom tab bar with 44px targets (`touch`) and safe-area padding.
- Each section opens with a section header: the uppercase label, then a `border` hairline to the right edge, with an optional mono count at the end.

### Widgets

Every widget is a tile and follows one anatomy: icon tile top-left (`icon-tile`, tinted), a mono value top-right when the widget has one, `tile-title`, a `meta` subtitle, a status line with a `dot`, and the bottom bar (`bar`) showing progress. The components below are the full set: SectionHeader, StatusPill, SkillTile, HeroTile, ListTile, RingGauge, RackCard, ReadoutTile, Chip, Button, Dock.

### The statue

The statue lives only in the hero tile. It is three aligned layers (assets in the Statue group): the obsidian base, the gold veins clipped to the tier's reach and brightened per body region by each category's score, and the bloom, blended with `screen`. Glow belongs to the statue alone: tiles get a corner glow, never a bloom.

### Motion and states

- Hover: edge to `border-strong`, corner glow to `glow-hover`, 160ms. Press: scale 0.985 for 140ms. Focus: 2px `focus-ring` outline, 2px offset.
- Logging a goal plays the power-up: a pulse of light runs to the statue, gold surges through the veins, and the goal's tile glow flares once. Nothing moves at rest.
- With reduced motion, transitions are instant and the power-up becomes a single brightness change.

### Accessibility

- Every text pairing in the token notes passes 4.5:1; marks, rings and focus rings pass 3:1 on `surface`.
- State is always a word as well as a colour: chips say "Done", "Open", "Floor"; status lines say "Neglected 8 days".
- Tap targets are at least `touch` on the phone. Icon-only buttons carry an accessible name.

## Iconography

- Lucide line icons, 18px, stroke 1.75, round caps and joins, in the category's text tint inside the tinted `icon-tile`.
- One icon per skill, chosen once and reused everywhere that skill appears (tile, rack card, readout).
- No emoji. The reference layout this system follows used emoji-style 3D icons; FORGE substitutes line icons so the board stays sharp.
