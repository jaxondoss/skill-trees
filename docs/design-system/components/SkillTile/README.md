# SkillTile

The tile for one skill: its icon, score, name, place in the plan and today's state, with the category's corner glow and a bottom bar showing the score.

- Markup: an `a.fg-tile.fg-glow.fg-cat-<category>` with `style="--p: <score>%"`, holding `fg-icon`, `fg-corner` (the score in mono), `fg-title`, `fg-sub`, `fg-status` and `fg-bar`.
- The consumer provides the skill name, category, icon, score (0 to 100), subtitle (rack slot, lock, cadence) and one status line.
- Status lines say what is true today in a few words: "Logged at Standard", "Store work, 25 of 40 min", "Neglected 8 days". A neglected or dormant skill uses `fg-quiet` (muted, no colour).
- The whole tile links to the skill page and needs an `aria-label` with name, score and status.
- 6 across on the laptop, 3 on a tablet, 2 on the phone. Do not add buttons inside; acting on a goal happens in the Today list or a rack card.
