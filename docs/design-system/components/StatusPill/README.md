# StatusPill

A rounded pill in the header that states one live value: the overall score, the streak, today's completion, last night's sleep.

- Small pill: `<span class="fg-pill fg-cat-school"><span class="fg-d"></span>Today <b>57%</b></span>`. The dot takes the category mark; the value is mono in `ink`.
- Big pill (`fg-big`) holds the overall score in gold with the tier under it; use one per header, first in the row.
- The consumer provides the label, the value with its unit, and the category class (`fg-cat-gold` for score and streak).
- At most five pills. They sit right-aligned on the laptop and wrap under the clock on the phone. A pill can link to its page; give it `aria-label` with the full sentence ("Today, 57% done").
