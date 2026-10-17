# HeroTile

The statue tile: the overall score in gold, the tier, the five category scores, and the statue lit to its tier. It is the board's single hero and its only glow.

- Markup: `div.fg-tile.fg-hero.fg-cat-gold` with the score (`score` style, `gold`), tier (`hero-title`), a short next-step line, five category rows, and `fg-statue` holding three images.
- Statue layers (Statue asset group): `statue-base.webp`, then `statue-veins.webp` and `statue-bloom.png` (bloom with `mix-blend-mode: screen`). Both gold layers share an elliptical mask centred at 47% 30% whose radius opens with the tier: I 0%, II 30%, III 58%, IV 92%, V 160%.
- In the app, the veins are also clipped into seven body regions, each at 0.55 plus 0.45 times its category's score; the category rows here are the readable version of that.
- The consumer provides the overall score, tier number and name, next-tier threshold, and the five category scores.
- Laptop: 5 columns, two rows tall, top-left. Phone: full width, the statue 60% of the tile height, under the Today list.
- One per screen. Never put a second gradient tile beside it.
