# Button

Two kinds of button and a segmented control. Primary is filled with the category mark and dark `on-category` text; ghost is `raised` with a border; segmented chooses one option of two or three.

- `button.fg-btn.fg-primary.fg-cat-<category>`: the one main action of a widget ("Log", "Save to Mind"). One per widget.
- `button.fg-btn.fg-ghost`: every other action ("Floor", "Undo", "Cancel").
- `div.fg-seg` with `button[aria-pressed]`: scope and range choices ("Today only" or "From now on"; "30 days" or "90 days").
- Labels name the action in sentence case. Add `fg-touch` for 44px height on the phone.
- Never a gradient or a glow on a button; never gold.
