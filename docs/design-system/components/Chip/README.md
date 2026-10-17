# Chip

A small rounded label that states a condition in one or two words: a tier, a state, a time left, a journal mood.

- Markup: `span.fg-chip.fg-cat-<category>` (category tint fill, text tint) or `span.fg-chip.fg-neutral` (raised fill, muted text). Optional leading `fg-d` dot.
- Coloured chips mean the thing is done or belongs to that category's success; neutral chips mean open, pending or a plain value.
- `fg-cat-gold` is only for "Kept" (a day at 85% or more).
- The word always carries the meaning; never a colour-only chip. Keep it to two words.
