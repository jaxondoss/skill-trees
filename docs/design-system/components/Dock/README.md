# Dock

The floating navigation bar at the bottom centre of the laptop board: one icon and label per destination, the current one on `raised` with a gold dot.

- Markup: `nav.fg-dock` of links, each an icon plus a short label; the current page has `aria-current="page"`.
- Destinations, in order: Overview, the five categories, Review, Journal, Settings.
- It floats over the board with `dock-lift` and stays fixed at the bottom; leave 96px of padding under the last section.
- Phone: becomes a full-width bottom tab bar with five items (Home, Skills, Journal as the centre action, Review, Settings), 44px targets and safe-area padding.
