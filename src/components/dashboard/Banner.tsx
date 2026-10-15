"use client";

import { Flame } from "lucide-react";
import { useState } from "react";

type Props = {
  overall: { display: number; tierName: string; tierNumeral: string; trendDelta: number | null };
  todayP: number | null;
  streak: { current: number; best: number };
};

export function Banner({ overall, todayP, streak }: Props) {
  const [showBest, setShowBest] = useState(false);
  const p = todayP === null ? null : Math.round(todayP);
  const delta = overall.trendDelta;

  return (
    <header className="glass sticky top-2 z-20 flex items-center justify-between gap-3 bg-[#141416]/92 px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
      <div className="leading-none">
        <div className="num text-3xl font-semibold tracking-tight" aria-label={`Overall score ${overall.display}`}>
          {overall.display}
        </div>
        <div className="mt-1 font-display text-xs tracking-wide text-gold">
          {overall.tierNumeral}. {overall.tierName}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => document.getElementById("today")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="flex min-h-11 items-center gap-2"
          aria-label={p === null ? "No plan today" : `Today ${p} percent. Jump to today's goals`}
        >
          <Ring value={p ?? 0} />
          <span className="text-left leading-tight">
            <span className="num block text-sm">{p === null ? "--" : `${p}%`}</span>
            <span className="block text-[11px] text-muted">Today</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setShowBest((v) => !v)}
          className="flex min-h-11 flex-col items-center justify-center leading-tight"
          aria-label={`Streak ${streak.current} days. Best ${streak.best}`}
        >
          <span className="flex items-center gap-1">
            <Flame size={14} className={streak.current > 0 ? "text-business" : "text-muted"} aria-hidden />
            <span className="num text-sm">{streak.current}</span>
          </span>
          <span className="num text-[11px] text-muted">{showBest ? `Best: ${streak.best}` : "Streak"}</span>
        </button>

        <div className="flex flex-col items-end leading-tight" aria-label="Change in overall score over 7 days">
          <span className={`num text-sm ${delta === null ? "text-muted" : delta >= 0 ? "text-nutrition" : "text-athletics"}`}>
            {delta === null ? "--" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
          </span>
          <span className="text-[11px] text-muted">7d</span>
        </div>
      </div>
    </header>
  );
}

function Ring({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="-rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--gold)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, value) / 100)}
        style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)" }}
      />
    </svg>
  );
}
