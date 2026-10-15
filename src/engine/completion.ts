import { formatHex, interpolate } from "culori";
import { addDays, daysBetween, weekStart } from "./time";
import type { DayKey, GoalKind, Tier } from "./types";

// ───────────────────────────── Daily completion P (spec 9.1)

const COMPLETION_VALUE: Record<Tier, number> = { floor: 0.5, standard: 1, stretch: 1.2 };

export const STREAK_THRESHOLD = 85;

export type DailyCompletion = {
  /** 0 to 100, or null when the day has no core goals. */
  p: number | null;
  nCore: number;
};

/**
 * P = min(100, 100 x (sum of core values + stretch value) / N_core).
 * The stretch goal adds to the numerator only, never the denominator.
 */
export function dailyCompletion(goals: { kind: GoalKind; result: Tier | null }[]): DailyCompletion {
  let nCore = 0;
  let sum = 0;
  for (const g of goals) {
    if (g.kind !== "stretch") nCore += 1;
    if (g.result) sum += COMPLETION_VALUE[g.result];
  }
  if (nCore === 0) return { p: null, nCore };
  return { p: Math.min(100, (100 * sum) / nCore), nCore };
}

// ───────────────────────────── Streak (spec 10)

export type StreakDay = { day: DayKey; p: number | null };

export type StreakResult = {
  current: number;
  best: number;
  /** Today already reached the threshold and is included in current. */
  todayCounted: boolean;
  /** Most recent break, for the crack animation and "Streak ended at N". */
  lastBreak: { on: DayKey; length: number } | null;
};

/**
 * A closed day keeps the streak at P >= 85. A day below 85, or with no plan after the
 * first planned day, breaks it. Today counts once it reaches 85 and never breaks the
 * streak while it is still open. No shields, no freezes.
 */
export function computeStreak(days: StreakDay[], today: DayKey): StreakResult {
  const byDay = new Map(days.filter((d) => d.p !== null).map((d) => [d.day, d.p as number]));
  const planned = [...byDay.keys()].filter((d) => d <= today).sort();
  const result: StreakResult = { current: 0, best: 0, todayCounted: false, lastBreak: null };
  if (!planned.length) return result;

  for (let day = planned[0]!; day <= today; day = addDays(day, 1)) {
    const p = byDay.get(day);
    const kept = p !== undefined && p >= STREAK_THRESHOLD;
    if (kept) {
      result.current += 1;
      result.best = Math.max(result.best, result.current);
      if (day === today) result.todayCounted = true;
    } else if (day !== today) {
      if (result.current > 0) result.lastBreak = { on: day, length: result.current };
      result.current = 0;
    }
  }
  return result;
}

export type WeekSummary = { weekStart: DayKey; keptDays: number; winning: boolean };

/** Weeks (Monday to Sunday) with 5+ days at 85% are "winning weeks", the forgiving measure. */
export function winningWeeks(days: StreakDay[]): WeekSummary[] {
  const weeks = new Map<DayKey, number>();
  for (const d of days) {
    const ws = weekStart(d.day);
    const kept = d.p !== null && d.p >= STREAK_THRESHOLD ? 1 : 0;
    weeks.set(ws, (weeks.get(ws) ?? 0) + kept);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([ws, keptDays]) => ({ weekStart: ws, keptDays, winning: keptDays >= 5 }));
}

// ───────────────────────────── Calendar colors (spec 9.2)

export const NEUTRAL_CELL = "#1C1C1F";
const scale = interpolate(["#7A1018", "#8A6A12", "#0E6B35"], "oklch");

/** OKLCH gradient: 0% dark red, 50% dark amber, 100% dark green. */
export const dayColor = (p: number) => formatHex(scale(Math.max(0, Math.min(1, p / 100))));

export type CellStyle = { fill: string; goldOutline: boolean; isToday: boolean };

export function cellStyle(day: StreakDay, today: DayKey): CellStyle {
  const isToday = daysBetween(day.day, today) === 0;
  const future = day.day > today;
  if (future || day.p === null) return { fill: NEUTRAL_CELL, goldOutline: false, isToday };
  return { fill: dayColor(day.p), goldOutline: day.p >= STREAK_THRESHOLD, isToday };
}
