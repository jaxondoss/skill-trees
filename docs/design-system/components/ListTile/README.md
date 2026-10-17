# ListTile

A tile that holds a short list of rows on `sunk`, each with a state chip; on the dashboard it is Today's checklist, and the same tile serves Due soon and Schedule.

- Markup: a `fg-tile` with an uppercase label and count, then `ul.fg-rows` of `li.fg-row.fg-cat-<category>` rows: `fg-check`, `fg-t` (the text) and a `fg-chip`.
- Today: tapping the check logs the goal at its planned tier in one tap (the 30-second rule); long-press or the row's menu opens the tiers and the editor. A done row adds `fg-done` (filled check, muted text) and a category chip with the tier word ("Done", "Floor", "Stretch"); open rows use a neutral chip ("Open" or the partial value, "25 min").
- Due soon: rows are assignments, the chip is the time left ("30 h"), coloured only when under 48 hours.
- Schedule: rows are time blocks, the chip is the time range in mono.
- The consumer provides the rows (text, category, state) and the handler for the check. At most 8 rows; longer lists scroll inside the tile.
- Each check is a button with an accessible name ("Log Training session"), at least 44px on the phone.
