# RingGauge

A tile that shows one percentage as a ring with the value in its centre and two or three facts beside it.

- Markup: a `fg-tile.fg-cat-<x>` with `div.fg-ring` (`style="--p: 57"`, a number 0 to 100) and its `span` value, then a label, a title and a subtitle. Optional segmented control (`fg-seg`) below for a range.
- Overall score: `fg-cat-gold`. Today's completion: the ring uses the school mark only because blue is neutral here; keep it the same everywhere.
- The consumer provides the value, the label and the facts. Rings never show more than one value; do not stack rings inside a ring.
- Give the ring `role="img"` and an `aria-label` with the sentence ("Overall 44.2, tier III Forged") when it is not next to that text.
