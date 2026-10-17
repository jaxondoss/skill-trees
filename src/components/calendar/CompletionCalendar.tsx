"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { getDayDetail, type DayDetail } from "@/app/actions";
import { Sheet } from "@/components/ui/Sheet";
import { cellStyle, STREAK_THRESHOLD } from "@/engine/completion";
import { addDays } from "@/engine/time";
import { rampColor } from "@/lib/palette";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const TIER_LABEL = { floor: "Floor", standard: "Standard", stretch: "Stretch" } as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** Month heatmap of daily completion P (spec 9). */
export function CompletionCalendar({ days, today }: { days: { day: string; p: number }[]; today: string }) {
  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d.p])), [days]);
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const first = days[0]?.day ?? today;
  const [fy, fm] = first.split("-").map(Number) as [number, number];
  const [cursor, setCursor] = useState({ y: ty, m: tm });
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [, startTransition] = useTransition();

  const canPrev = cursor.y > fy || (cursor.y === fy && cursor.m > fm);
  const canNext = cursor.y < ty || (cursor.y === ty && cursor.m < tm);
  const shift = (delta: number) =>
    setCursor(({ y, m }) => {
      const idx = y * 12 + (m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  const start = `${cursor.y}-${pad(cursor.m)}-01`;
  // Weeks start on Monday, like reviews and winning weeks.
  const lead = (new Date(`${start}T12:00:00Z`).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const cells = Array.from({ length: count }, (_, i) => addDays(start, i));

  const open = (day: string) =>
    startTransition(async () => {
      setDetail(await getDayDetail(day));
    });

  return (
    <section aria-label="Completion calendar" className="tile space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="lbl">
          {MONTHS[cursor.m - 1]} <span className="num font-mono">{cursor.y}</span>
        </h2>
        <div className="flex gap-1">
          <button type="button" disabled={!canPrev} onClick={() => shift(-1)} className="flex size-11 items-center justify-center rounded-full text-muted hover:text-text disabled:opacity-30" aria-label="Previous month">
            <ChevronLeft size={20} />
          </button>
          <button type="button" disabled={!canNext} onClick={() => shift(1)} className="flex size-11 items-center justify-center rounded-full text-muted hover:text-text disabled:opacity-30" aria-label="Next month">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.x > 60 && canPrev) shift(-1);
          if (info.offset.x < -60 && canNext) shift(1);
        }}
        className="grid touch-pan-y grid-cols-7 gap-[5px]"
        role="group"
        aria-label="Days"
      >
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-1 text-center text-[10px] font-bold tracking-widest text-label" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {cells.map((day, i) => {
          const p = byDay.get(day) ?? null;
          const style = cellStyle({ day, p }, today);
          const label = `${day}: ${p === null ? (day > today ? "upcoming" : "no plan") : `${Math.round(p)}%`}`;
          const shown = day > today || p === null ? null : p;
          const fill = rampColor(shown);
          // A gold line wraps each run of kept days; it opens where the run continues into the next cell.
          const col = (lead + i) % 7;
          const kept = (d: string) => d <= today && (byDay.get(d) ?? -1) >= STREAK_THRESHOLD;
          const isKept = style.goldOutline;
          const l = isKept && col > 0 && kept(addDays(day, -1));
          const r = isKept && col < 6 && kept(addDays(day, 1));
          return (
            <button
              key={day}
              type="button"
              disabled={p === null && day !== today}
              onClick={() => open(day)}
              aria-label={label}
              className={`relative aspect-[1.25] rounded-[7px] text-left font-mono text-[10.5px] font-semibold ${style.isToday ? "today-pulse" : ""}`}
              style={{
                background: fill ?? "var(--sunk)",
                boxShadow: fill ? "inset 0 1px 0 rgba(255,255,255,.2)" : "inset 0 1px 2px rgba(0,0,0,.4)",
                color: shown !== null && shown >= 50 ? "var(--bg)" : "var(--text)",
              }}
            >
              <span className="num absolute top-1 left-1.5">{Number(day.slice(8))}</span>
              {isKept && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-[3px] border-2 border-gold shadow-[0_0_8px_rgba(212,175,55,0.35)]"
                  style={{
                    borderLeftWidth: l ? 0 : 2,
                    borderRightWidth: r ? 0 : 2,
                    borderRadius: `${l ? 0 : 9}px ${r ? 0 : 9}px ${r ? 0 : 9}px ${l ? 0 : 9}px`,
                    left: l ? -3 : undefined,
                    right: r ? -6 : undefined,
                  }}
                />
              )}
            </button>
          );
        })}
      </motion.div>

      <div className="flex flex-wrap items-center gap-[5px] text-[11px] text-label" aria-hidden>
        <span>Less</span>
        {[1, 2, 3, 4, 5].map((k) => (
          <i key={k} className="size-3 rounded-[3px]" style={{ background: `var(--r${k})` }} />
        ))}
        <span>More</span>
        <span className="ml-2 h-3 w-5 rounded-[3px] border-2 border-gold" />
        <span>Kept run</span>
      </div>

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail ? detail.day : ""}>
        {detail && (
          <ul className="space-y-2">
            {detail.goals.length === 0 && <li className="text-sm text-muted">No plan that day.</li>}
            {detail.goals.map((g) => (
              <li key={g.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <span className="mt-1 size-2.5 shrink-0 rounded-full" style={g.resultTier ? { background: g.color } : { boxShadow: `inset 0 0 0 1px ${g.color}` }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted">
                    {g.skillName} <span aria-hidden>·</span> {g.title}
                    {g.kind === "stretch" ? " (stretch)" : ""}
                  </p>
                  <p className="text-sm">{g.text}</p>
                  {g.userNote && <p className="text-xs text-muted italic">{g.userNote}</p>}
                </div>
                <span className="shrink-0 text-xs">{g.resultTier ? TIER_LABEL[g.resultTier] : <span className="text-athletics">Missed</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </section>
  );
}
