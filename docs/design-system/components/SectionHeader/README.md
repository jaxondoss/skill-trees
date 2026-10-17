# SectionHeader

Opens each section of the board with an uppercase label and a hairline that runs to the right edge.

- Markup: `<div class="fg-section"><h2>Skills</h2><span class="fg-meta">15</span></div>`. The `h2` holds the section name in sentence case; CSS sets it uppercase in `section-label` and `ink-label`.
- The consumer provides the name and, optionally, a mono count or short meta (`fg-meta`).
- Sections on the dashboard, in order: SKILLS, RACK, NUMBERS, RECORD. Do not add a header above the top row; the header bar opens it.
- Never stack two headers or put a header inside a tile.
