import { addDays, daysBetween } from "./time";
import type { DayKey } from "./types";

/**
 * Daily trackers that stand in for integrations (spec 12): one-tap sleep, meal quick-add,
 * gut rating, and evening block adherence. Each turns raw entries into the values
 * that milestone rules read.
 */

// ───────────────────────────── Sleep (spec 12.8)

export type SleepConfig = {
  startLightsOut: string; // "02:00"
  finalLightsOut: string; // "00:45"
  stepMinPerWeek: number; // 15
  inWindowToleranceMin: number; // 45
};

export const DEFAULT_SLEEP: SleepConfig = { startLightsOut: "02:00", finalLightsOut: "00:45", stepMinPerWeek: 15, inWindowToleranceMin: 45 };

/** Clock time as minutes after noon, so a bedtime of 23:30 (690) sorts before 01:15 (795). */
export function minutesAfterNoon(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return (((h - 12 + 24) % 24) * 60 + m) % 1440;
}

export function formatAfterNoon(min: number): string {
  const total = (min + 12 * 60) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Lights-out anchor for a night: starts at the current pattern and moves earlier each week, never past the final anchor. */
export function sleepAnchor(day: DayKey, startDay: DayKey, cfg: SleepConfig = DEFAULT_SLEEP): number {
  const weeks = Math.max(0, Math.floor(daysBetween(startDay, day) / 7));
  return Math.max(minutesAfterNoon(cfg.finalLightsOut), minutesAfterNoon(cfg.startLightsOut) - weeks * cfg.stepMinPerWeek);
}

export type SleepSession = { day: DayKey; sleptAt: string; wokeAt: string | null };
export type Night = { day: DayKey; hours: number | null; bedtime: number; anchor: number; inWindow: boolean };

/** Local clock time of an instant in a time zone, as "HH:MM". */
export function localHHMM(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function nights(sessions: SleepSession[], timeZone: string, startDay: DayKey, cfg: SleepConfig = DEFAULT_SLEEP): Night[] {
  return sessions
    .map((s) => {
      const bedtime = minutesAfterNoon(localHHMM(s.sleptAt, timeZone));
      const anchor = sleepAnchor(s.day, startDay, cfg);
      const hours = s.wokeAt ? (new Date(s.wokeAt).getTime() - new Date(s.sleptAt).getTime()) / 3_600_000 : null;
      return { day: s.day, hours, bedtime, anchor, inWindow: Math.abs(bedtime - anchor) <= cfg.inWindowToleranceMin };
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function sleepDerived(list: Night[], today: DayKey): Record<string, number> {
  const out: Record<string, number> = {};
  if (!list.length) return out;
  out.sleep_logged_days = new Set(list.map((n) => n.day)).size;
  out.sleep_in_window_streak = longestDailyRun(list.filter((n) => n.inWindow).map((n) => n.day));

  const recent = list.filter((n) => n.hours !== null && daysBetween(n.day, today) < 14);
  if (recent.length >= 10) out.sleep_avg_hours_14d = recent.reduce((s, n) => s + n.hours!, 0) / recent.length;

  const first = list[0]!.day;
  for (const days of [30, 90]) {
    if (daysBetween(first, today) < days - 1) continue;
    const inWindow = new Set(list.filter((n) => n.inWindow && daysBetween(n.day, today) < days).map((n) => n.day)).size;
    out[`sleep_in_window_${days}d_pct`] = (100 * inWindow) / days;
  }
  return out;
}

// ───────────────────────────── Food and gut (spec 12.10, 12.11)

export type DailyEntry = { key: string; value: number; day: DayKey };
export type FuelTargets = { calories: number; proteinG: number; calorieTolerancePct: number };

/** Sum of each key per day. */
export function dailySums(entries: DailyEntry[], keys: string[]): Map<DayKey, Record<string, number>> {
  const out = new Map<DayKey, Record<string, number>>();
  for (const e of entries) {
    if (!keys.includes(e.key)) continue;
    const day = out.get(e.day) ?? {};
    day[e.key] = (day[e.key] ?? 0) + e.value;
    out.set(e.day, day);
  }
  return out;
}

export const MEAL_KEYS = ["meal_calories", "meal_protein_g", "meal_fiber_g"];

export function foodDerived(entries: DailyEntry[], today: DayKey, targets: FuelTargets): Record<string, number> {
  const days = dailySums(entries, MEAL_KEYS);
  if (!days.size) return {};
  const last7 = (pred: (d: Record<string, number>) => boolean) =>
    Array.from({ length: 7 }, (_, i) => days.get(addDays(today, -i))).filter((d) => d && pred(d)).length;
  const withinCalories = (d: Record<string, number>) =>
    Math.abs((d.meal_calories ?? 0) - targets.calories) <= (targets.calories * targets.calorieTolerancePct) / 100;
  const dayList = (pred: (d: Record<string, number>) => boolean) => [...days.entries()].filter(([, d]) => pred(d)).map(([day]) => day);

  return {
    protein_target_days_7d: last7((d) => (d.meal_protein_g ?? 0) >= targets.proteinG),
    calorie_target_streak: longestDailyRun(dayList(withinCalories)),
    fiber_30g_days_7d: last7((d) => (d.meal_fiber_g ?? 0) >= 30),
    fiber_38g_streak: longestDailyRun(dayList((d) => (d.meal_fiber_g ?? 0) >= 38)),
  };
}

/** Gut wellness rating (1 to 5): days logged, and the gain of the latest 30 days over the first 30. */
export function ratingDerived(entries: DailyEntry[]): Record<string, number> {
  const byDay = new Map<DayKey, number>();
  for (const e of entries) if (e.key === "gut_rating") byDay.set(e.day, e.value);
  if (!byDay.size) return {};
  const days = [...byDay.keys()].sort();
  const out: Record<string, number> = { gut_ratings_logged: days.length };
  if (days.length >= 60) {
    const avg = (list: DayKey[]) => list.reduce((s, d) => s + byDay.get(d)!, 0) / list.length;
    out.gut_rating_gain = avg(days.slice(-30)) - avg(days.slice(0, 30));
  }
  return out;
}

/** Evening self-rating of blocks kept (0, 25, 50, 75, 100): longest runs at each threshold. */
export function adherenceDerived(entries: DailyEntry[]): Record<string, number> {
  const byDay = new Map<DayKey, number>();
  for (const e of entries) if (e.key === "block_adherence_pct") byDay.set(e.day, e.value);
  if (!byDay.size) return {};
  const at = (min: number) => longestDailyRun([...byDay.entries()].filter(([, v]) => v >= min).map(([d]) => d));
  return { adherence_70_streak_days: at(70), adherence_80_streak_days: at(80), adherence_85_streak_days: at(85) };
}

function longestDailyRun(days: DayKey[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  sorted.forEach((d, i) => {
    run = i > 0 && daysBetween(sorted[i - 1]!, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/** Calorie target for a day: base, plus the run burn on long-run days (spec 12.10). */
export function calorieTarget(base: number, longRunMiles: number | null, caloriesPerMile = 100): number {
  return base + (longRunMiles ? Math.round(longRunMiles * caloriesPerMile) : 0);
}
