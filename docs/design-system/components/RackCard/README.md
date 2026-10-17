# RackCard

A wide card for one of the five rack skills: an icon ring showing today's progress, the skill, a state chip, today's goal, and two buttons.

- Markup: `fg-tile.fg-cat-<category>` with `fg-ring.fg-icon-ring` (`--p` is today's progress), the title, a `fg-chip`, a `meta` line with the goal and tier, and a `fg-btn fg-primary` plus a `fg-btn fg-ghost`.
- Primary is the one-tap action: "Log" at the planned tier (dark `on-category` text on the category fill). Ghost is the alternative: "Floor" before logging; once logged, the buttons become "Edit" and "Undo".
- The consumer provides the skill, category, icon, today's goal text, tier, progress and handlers.
- Four or five across on the laptop (the rack is always five), one per row on the phone. The lock ("locked 3 days") goes in the chip area only when the user tries to unpin.
