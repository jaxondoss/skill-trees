"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { getDayDetail, type DayDetail } from "@/app/actions";
import { Sheet } from "@/components/ui/Sheet";
import { cellStyle } from "@/engine/completion";
import { addDays } from "@/engine/time";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
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
  const lead = new Date(`${start}T12:00:00Z`).getUTCDay();
  const count = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const cells = Array.from({ length: count }, (_, i) => addDays(start, i));

  const open = (day: string) =>
    startTransition(async () => {
      setDetail(await getDayDetail(day));
    });

  return (
    <section aria-label="Completion calendar" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">
          {MONTHS[cursor.m - 1]} <span className="num text-muted">{cursor.y}</span>
        </h2>
        <div className="flex gap-1">
          <button type="button" disabled={!canPrev} onClick={() => shift(-1)} className="flex size-11 items-center justify-center rounded-full text-muted disabled:opacity-30" aria-label="Previous month">
            <ChevronLeft size={20} />
          </button>
          <button type="button" disabled={!canNext} onClick={() => shift(1)} className="flex size-11 items-center justify-center rounded-full text-muted disabled:opacity-30" aria-label="Next month">
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
        className="grid touch-pan-y grid-cols-7 gap-1.5"
        role="group"
        aria-label="Days"
      >
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-1 text-center text-[10px] text-muted" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {cells.map((day) => {
          const p = byDay.get(day) ?? null;
          const style = cellStyle({ day, p }, today);
          const label = `${day}: ${p === null ? (day > today ? "upcoming" : "no plan") : `${Math.round(p)}%`}`;
          return (
            <button
              key={day}
              type="button"
              disabled={p === null && day !== today}
              onClick={() => open(day)}
              aria-label={label}
              className={`relative aspect-square rounded-lg text-[11px] ${style.isToday ? "today-pulse" : ""}`}
              style={{ background: style.fill, boxShadow: style.goldOutline ? "inset 0 0 0 1.5px #D4AF37" : undefined }}
            >
              <span className="num absolute top-1 left-1.5 text-white/60">{Number(day.slice(8))}</span>
            </button>
          );
        })}
      </motion.div>

      <div className="flex items-center justify-between text-[10px] text-muted" aria-hidden>
        <span>0%</span>
        <span className="mx-2 h-1.5 flex-1 rounded-full" style={{ background: "linear-gradient(90deg,#7A1018,#8A6A12,#0E6B35)" }} />
        <span>100%</span>
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
