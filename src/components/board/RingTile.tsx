"use client";

const scrollTo = (selector: string) => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelector(selector)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

/** Today's completion ring with the streak. The ring jumps to the checklist; the streak to the calendar. */
export function RingTile({ pct, streak, best }: { pct: number; streak: number; best: number }) {
  return (
    <section className="tile flex items-center gap-4" aria-label="Today and streak">
      <button type="button" onClick={() => scrollTo("#today")} className="ring rounded-full" style={{ ["--p" as string]: pct }} aria-label={`Today ${pct}%. Jump to today's goals`}>
        <span className="font-mono text-xl font-bold">
          {pct}
          <small className="text-[11px] text-muted">%</small>
        </span>
      </button>
      <dl className="grid flex-1 gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-muted">Today</dt>
          <dd className="font-mono text-[15px] font-semibold">{pct}%</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-muted">Streak</dt>
          <dd>
            <button
              type="button"
              onClick={() => scrollTo('section[aria-label="Completion calendar"]')}
              className="font-mono text-[15px] font-semibold text-gold hover:underline"
              aria-label={`Streak ${streak} days. Best ${best}. Show the calendar`}
            >
              {streak} {streak === 1 ? "day" : "days"}
            </button>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-muted">Best</dt>
          <dd className="font-mono text-[15px] font-semibold">{best}</dd>
        </div>
      </dl>
    </section>
  );
}
