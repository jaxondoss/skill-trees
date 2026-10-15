import { STREAK_THRESHOLD } from "./completion";
import { addDays, weekday } from "./time";
import type { DayKey, GoalRecord, Tier } from "./types";

/** Weekly and monthly review math (spec 4.4). Pure: rows in, plain values out. */

export type DifficultyKind = "level_up" | "ease";

const LADDER: Tier[] = ["floor", "standard", "stretch"];

/** Level up moves the default tier one step toward Stretch; ease moves it one step toward Floor. */
export function applyDifficulty(tier: Tier, kind: DifficultyKind): Tier {
  const i = LADDER.indexOf(tier) + (kind === "level_up" ? 1 : -1);
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, i))]!;
}

/** Reviews happen on Sunday; the monthly one on the first Sunday of the month. */
export const isSunday = (day: DayKey) => weekday(day) === 0;
export const isFirstSunday = (day: DayKey) => isSunday(day) && Number(day.slice(8, 10)) <= 7;
export const monthStart = (day: DayKey): DayKey => `${day.slice(0, 7)}-01`;
export const previousMonthEnd = (day: DayKey): DayKey => addDays(monthStart(day), -1);

export type WeekDays = { day: DayKey; p: number | null }[];

/** Average completion and days at 85% or more over the days that had a plan. */
export function weekCompletion(days: WeekDays): { avg: number | null; kept: number; planned: number } {
  const planned = days.filter((d): d is { day: DayKey; p: number } => d.p !== null);
  return {
    avg: planned.length ? planned.reduce((s, d) => s + d.p, 0) / planned.length : null,
    kept: planned.filter((d) => d.p >= STREAK_THRESHOLD).length,
    planned: planned.length,
  };
}

export type Mover = { id: string; delta: number };

/**
 * Biggest riser and biggest slipper between two score maps. Only skills with both values count,
 * and a "slipper" must actually have dropped (and a riser risen).
 */
export function movers(now: Map<string, number>, before: Map<string, number>): { riser: Mover | null; slipper: Mover | null } {
  const deltas = [...now].flatMap(([id, score]) => {
    const prev = before.get(id);
    return prev === undefined ? [] : [{ id, delta: score - prev }];
  });
  const up = deltas.filter((d) => d.delta > 0.05).sort((a, b) => b.delta - a.delta)[0] ?? null;
  const down = deltas.filter((d) => d.delta < -0.05).sort((a, b) => a.delta - b.delta)[0] ?? null;
  return { riser: up, slipper: down };
}

/** Skills with the most missed core goals in [from, to), most missed first. Today is never a miss. */
export function mostMissed(history: GoalRecord[], from: DayKey, to: DayKey, limit = 3): { skillId: string; missed: number; scheduled: number }[] {
  const tally = new Map<string, { missed: number; scheduled: number }>();
  for (const g of history) {
    if (g.kind === "stretch" || g.day < from || g.day >= to) continue;
    const t = tally.get(g.skillId) ?? { missed: 0, scheduled: 0 };
    t.scheduled += 1;
    if (!g.result) t.missed += 1;
    tally.set(g.skillId, t);
  }
  return [...tally]
    .filter(([, t]) => t.missed > 0)
    .sort(([, a], [, b]) => b.missed - a.missed || b.scheduled - a.scheduled)
    .slice(0, limit)
    .map(([skillId, t]) => ({ skillId, ...t }));
}

export type Calibration = "too_high" | "right" | "too_low";

/**
 * Calibration answers across months, per skill: a consistent "too high" or "too low" over
 * the last three answers suggests the milestone weights need a look.
 */
export function calibrationDrift(history: Record<string, Calibration>[]): Map<string, Calibration> {
  const out = new Map<string, Calibration>();
  const recent = history.slice(-3);
  if (recent.length < 2) return out;
  const ids = new Set(recent.flatMap((m) => Object.keys(m)));
  for (const id of ids) {
    const answers = recent.map((m) => m[id]).filter((a): a is Calibration => Boolean(a));
    if (answers.length >= 2 && answers.every((a) => a === answers[0]) && answers[0] !== "right") out.set(id, answers[0]!);
  }
  return out;
}
