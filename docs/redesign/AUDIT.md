# FORGE audit before the redesign (2026-10-17)

Screenshots of every screen at 1440 and 390 are in `audit/` (seeded with 20 days of history on the local
e2e stack). Checked against the web-interface-guidelines rules and the redesign-skill audit.

## Layout and information
- **Laptop wastes most of the screen.** Everything sits in one 672px column centred on 1440; about half
  the width is empty and the dashboard is 3,300px tall. Nothing is visible at once: score, figure, today,
  calendar and archive are a long scroll. This is the main reason for the redesign.
- **Navigation is buried.** Review, Settings and Sign out are small links at the very bottom; categories
  are reachable only by tapping figure boxes.
- **Duplicated content.** The rack bottles strip repeats the rack goals right under it.
- **Category boxes are mostly empty**: a score ring and one line ("Lowest: ...") in a tall outlined box.
- **Calendar is oversized on desktop** (cells about 90px) and starts weeks on Sunday while winning weeks
  and reviews use Monday.
- **Archive shelves are wide and sparse**; the filter chip row overflows and clips ("Dc").
- **Skill page empty states are blank space** (history chart with no points shows a 150px gap).

## Visual
- Tracked uppercase labels everywhere (RACK, BALANCE, SCORE, METRICS, category names): a generated-page tell.
- Overall score is small (24px) for the number the whole app is about; tier name is the strongest text.
- 1px coloured outlines with glow on every category box: glow is spread out instead of concentrated.
- Completion colour scale passes through muddy olive at 40 to 70%.
- Several near-equal text sizes (10, 11, 12, 13, 14px) in cards.

## Guidelines findings (web-interface-guidelines)
- `src/components/today/TodayPanel.tsx:360`, `src/app/login/login-form.tsx:45`: `outline-none` with only a
  border-colour focus; no `:focus-visible` ring anywhere in the app (0 uses).
- `src/components/skill/SkillClient.tsx:252, 389`: raw ISO dates (`2026-10-16`); use `Intl.DateTimeFormat`.
- 47 inputs without `name` or `autocomplete`.
- Loading labels lack the ellipsis (`"Writing"`, `"Reading the photo"`); should read `Writing…`.
- No `overscroll-behavior: contain` on sheets; no `touch-action: manipulation`.
- Toast ("New guidance unlocked") covers the skill title on load.

## Keep
The figure and the idea of category energy lines, bottles (as the archive), the completion colour scale
(retuned), the 30-second tap logging, the tier-up and streak-crack moments, sounds, the explainable score
breakdown, and all engines and data.

## Replace
The single-column layout (laptop-first grid with sidebar and right rail), outlined boxes (flat surfaces
with a lit top edge), uppercase labels (sentence case), the bottom link navigation (sidebar and phone tab
bar), the bottles strip under the rack (gone; the archive keeps them), ISO dates, and focus styles.
