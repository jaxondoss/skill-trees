# ReadoutTile

A tile for one measured number: the value large in mono and in its category's text tint, an uppercase label, a short context line, and a bottom bar toward its next milestone.

- Markup: `fg-tile.fg-cat-<category>` with `style="--p: <progress>%"`, `fg-icon`, `fg-readout` (value, then the unit in `small`), `fg-label`, `fg-sub` and `fg-bar`.
- The consumer provides the value, unit, label, context line and the progress toward the next milestone target.
- Readouts on the dashboard: sleep, bodyweight, top bench set, weekly miles, chess rating, store revenue. Six across on the laptop, two on the phone.
- Tapping the tile opens the inline number entry (type the value, Enter); the tile itself is the input surface, so no separate button.
- The value colour carries identity only; the label and unit always state what it is.
