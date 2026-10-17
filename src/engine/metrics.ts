import { addDays, daysBetween, weekStart } from "./time";
import type { DayKey, GoalRecord, Tier } from "./types";

/**
 * Metrics feed milestone auto-claims (spec 6.3). Two sources:
 * 1. Manual entries (and later integrations) in the metrics table, aggregated per key.
 * 2. Values derived from goal history (streaks, counts, completion over a window).
 * Keys match the `rule.key` of seeded milestones.
 */

export type MetricFormat = "number" | "time" | "usd" | "percent";
export type MetricDef = {
  key: string;
  skill: string;
  label: string;
  unit: string;
  format: MetricFormat;
  /** How multiple entries combine into one value. */
  agg: "latest" | "max" | "min" | "sum";
  /** Entry step hint for the input. */
  step?: number;
};

export const METRIC_DEFS: MetricDef[] = [
  { key: "bench_1rm", skill: "strength", label: "Bench (top set or 1RM)", unit: "lb", format: "number", agg: "max", step: 5 },
  { key: "squat_1rm", skill: "strength", label: "Squat (top set or 1RM)", unit: "lb", format: "number", agg: "max", step: 5 },
  { key: "bodyweight_lb", skill: "strength", label: "Bodyweight", unit: "lb", format: "number", agg: "latest", step: 0.1 },
  { key: "long_run_mi", skill: "running", label: "Long run", unit: "mi", format: "number", agg: "max", step: 0.1 },
  { key: "half_marathon_best_s", skill: "running", label: "Half marathon time", unit: "", format: "time", agg: "min" },
  { key: "marathon_best_s", skill: "running", label: "Marathon time", unit: "", format: "time", agg: "min" },
  { key: "chess_rating", skill: "chess", label: "Rating", unit: "", format: "number", agg: "latest", step: 1 },
  { key: "books_finished", skill: "reading", label: "Books finished", unit: "books", format: "number", agg: "sum", step: 1 },
  { key: "reading_effective_rate", skill: "reading", label: "Effective reading rate (wpm x comprehension)", unit: "wpm", format: "number", agg: "latest", step: 1 },
  { key: "revenue_month_usd", skill: "dropshipping", label: "Monthly revenue", unit: "$", format: "usd", agg: "sum", step: 1 },
  { key: "revenue_week_usd", skill: "dropshipping", label: "Weekly revenue", unit: "$", format: "usd", agg: "sum", step: 1 },
  { key: "ad_spend_week_usd", skill: "dropshipping", label: "Weekly ad spend", unit: "$", format: "usd", agg: "sum", step: 1 },
  { key: "orders_week", skill: "dropshipping", label: "Weekly orders", unit: "", format: "number", agg: "sum", step: 1 },
  { key: "store_teardowns", skill: "dropshipping", label: "Store teardowns", unit: "", format: "number", agg: "sum", step: 1 },
  { key: "shipped_products", skill: "ai-building", label: "Shipped products with users", unit: "", format: "number", agg: "sum", step: 1 },
  { key: "semester_gpa", skill: "academics", label: "Semester GPA", unit: "", format: "number", agg: "latest", step: 0.01 },
  { key: "deans_list_count", skill: "academics", label: "Dean's List", unit: "times", format: "number", agg: "sum", step: 1 },
  { key: "cumulative_gpa_after_year_2", skill: "academics", label: "Cumulative GPA after sophomore year", unit: "", format: "number", agg: "latest", step: 0.01 },
  { key: "graduation_gpa", skill: "academics", label: "Graduation GPA", unit: "", format: "number", agg: "latest", step: 0.01 },
  { key: "max_professor_conversations", skill: "college-integration", label: "Most conversations with one professor", unit: "", format: "number", agg: "max", step: 1 },
  { key: "org_attendance_semester_pct", skill: "college-integration", label: "Org attendance this semester", unit: "%", format: "percent", agg: "latest", step: 1 },
  { key: "go_to_meals", skill: "food", label: "Go-to meals learned", unit: "meals", format: "number", agg: "sum", step: 1 },
  { key: "bodyweight_on_pace_weeks", skill: "food", label: "Weeks bodyweight on pace", unit: "weeks", format: "number", agg: "latest", step: 1 },
  { key: "plants_best_week", skill: "gut-health", label: "Different plants in a week", unit: "", format: "number", agg: "max", step: 1 },
  { key: "gut_rating_gain", skill: "gut-health", label: "Avg rating vs first month", unit: "pts", format: "number", agg: "latest", step: 0.1 },
  { key: "vision_rewrites", skill: "visualization", label: "Quarterly vision rewrites", unit: "", format: "number", agg: "sum", step: 1 },
  { key: "swim_continuous_m", skill: "triathlon", label: "Continuous swim", unit: "m", format: "number", agg: "max", step: 25 },
  { key: "bike_ride_mi", skill: "triathlon", label: "Bike ride", unit: "mi", format: "number", agg: "max", step: 1 },
  { key: "half_ironman_best_s", skill: "triathlon", label: "70.3 time", unit: "", format: "time", agg: "min" },
  // Redesign (spec v2 r2, 6): the numbers each skill's visualization draws from.
  { key: "run_mi", skill: "running", label: "Run", unit: "mi", format: "number", agg: "sum", step: 0.1 },
  { key: "deadlift_1rm", skill: "strength", label: "Deadlift (top set or 1RM)", unit: "lb", format: "number", agg: "max", step: 5 },
  { key: "swim_min", skill: "triathlon", label: "Swim", unit: "min", format: "number", agg: "sum", step: 5 },
  { key: "bike_min", skill: "triathlon", label: "Ride", unit: "min", format: "number", agg: "sum", step: 5 },
  { key: "vividness", skill: "visualization", label: "Vividness", unit: "of 5", format: "number", agg: "latest", step: 1 },
];

export const METRIC_BY_KEY = new Map(METRIC_DEFS.map((d) => [d.key, d]));

export type MetricEntry = { key: string; value: number; day: DayKey; recordedAt?: string };

/** One value per key from manual entries, plus keys computed from other entries. */
export function aggregateEntries(entries: MetricEntry[]): Record<string, number> {
  const byKey = new Map<string, MetricEntry[]>();
  for (const e of entries) {
    if (!Number.isFinite(e.value)) continue;
    byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  }
  const out: Record<string, number> = {};
  for (const [key, list] of byKey) {
    const agg = METRIC_BY_KEY.get(key)?.agg ?? "latest";
    const values = list.map((e) => e.value);
    out[key] =
      agg === "max"
        ? Math.max(...values)
        : agg === "min"
          ? Math.min(...values)
          : agg === "sum"
            ? values.reduce((a, b) => a + b, 0)
            : latest(list).value;
  }

  // Derived from entries. Revenue arrives monthly or weekly (Sunday review); both roll up by month.
  const revenue = [...(byKey.get("revenue_month_usd") ?? []), ...(byKey.get("revenue_week_usd") ?? [])];
  if (revenue.length) {
    const byMonth = new Map<string, number>();
    for (const e of revenue) byMonth.set(e.day.slice(0, 7), (byMonth.get(e.day.slice(0, 7)) ?? 0) + e.value);
    const months = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    out.revenue_total_usd = months.reduce((a, [, v]) => a + v, 0);
    out.revenue_best_month_usd = Math.max(...months.map(([, v]) => v));
    out.revenue_10k_month_streak = longestRun(months.map(([, v]) => v >= 10_000));
  }
  const gpas = byKey.get("semester_gpa") ?? [];
  if (gpas.length) {
    out.first_semester_gpa = chronological(gpas)[0]!.value;
    out.best_semester_gpa = Math.max(...gpas.map((e) => e.value));
    out.semesters_at_4_0 = gpas.filter((e) => e.value >= 4).length;
  }
  // Reading tests (spec 12.4): the first effective rate is the baseline.
  const tests = chronological(byKey.get("reading_effective_rate") ?? []);
  if (tests.length) {
    out.reading_tests_taken = tests.length;
    const base = tests[0]!.value;
    if (base > 0 && tests.length > 1) out.effective_rate_gain_pct = (100 * (tests.at(-1)!.value - base)) / base;
  }
  const ratings = byKey.get("chess_rating") ?? [];
  if (ratings.length) out.chess_ratings_recorded = ratings.length;
  return out;
}

const chronological = (list: MetricEntry[]) =>
  [...list].sort((a, b) => (a.day + (a.recordedAt ?? "")).localeCompare(b.day + (b.recordedAt ?? "")));
const latest = (list: MetricEntry[]) => chronological(list).at(-1)!;

function longestRun(flags: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const f of flags) {
    run = f ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

// ───────────────────────────── Derived from goal history

const VALUE: Record<Tier, number> = { floor: 0.5, standard: 1, stretch: 1 };

type Derivation =
  | { kind: "longest_daily_run"; skill: string | "*"; minTier?: Tier }
  | { kind: "count_days"; skill: string }
  | { kind: "window_pct"; skill: string; days: number }
  | { kind: "weekly_run"; skill: string; perWeek: number };

/** History-based values, keyed like milestone rules. Approximations are noted inline. */
export const DERIVED: Record<string, Derivation> = {
  app_use_streak_days: { kind: "longest_daily_run", skill: "*" },
  meditation_streak_days: { kind: "longest_daily_run", skill: "meditation" },
  visualization_streak_days: { kind: "longest_daily_run", skill: "visualization" },
  planned_nights_streak: { kind: "longest_daily_run", skill: "time-blocking" },
  meals_logged_streak: { kind: "longest_daily_run", skill: "food" },
  calorie_target_streak: { kind: "longest_daily_run", skill: "food", minTier: "standard" },
  sleep_in_window_streak: { kind: "longest_daily_run", skill: "sleep", minTier: "standard" },
  fiber_38g_streak: { kind: "longest_daily_run", skill: "gut-health", minTier: "standard" },
  sleep_logged_days: { kind: "count_days", skill: "sleep" },
  gut_ratings_logged: { kind: "count_days", skill: "gut-health" },
  fermented_food_days: { kind: "count_days", skill: "gut-health" },
  meditation_30d_pct: { kind: "window_pct", skill: "meditation", days: 30 },
  meditation_60d_pct: { kind: "window_pct", skill: "meditation", days: 60 },
  meditation_182d_pct: { kind: "window_pct", skill: "meditation", days: 182 },
  meditation_365d_pct: { kind: "window_pct", skill: "meditation", days: 365 },
  visualization_30d_pct: { kind: "window_pct", skill: "visualization", days: 30 },
  visualization_90d_pct: { kind: "window_pct", skill: "visualization", days: 90 },
  visualization_365d_pct: { kind: "window_pct", skill: "visualization", days: 365 },
  sleep_in_window_30d_pct: { kind: "window_pct", skill: "sleep", days: 30 },
  sleep_in_window_90d_pct: { kind: "window_pct", skill: "sleep", days: 90 },
  fuel_targets_30d_pct: { kind: "window_pct", skill: "food", days: 30 },
  fuel_targets_90d_pct: { kind: "window_pct", skill: "food", days: 90 },
  gut_habits_30d_pct: { kind: "window_pct", skill: "gut-health", days: 30 },
  gut_habits_90d_pct: { kind: "window_pct", skill: "gut-health", days: 90 },
  planned_nights_30d_pct: { kind: "window_pct", skill: "time-blocking", days: 30 },
  weeks_with_6_sessions_streak: { kind: "weekly_run", skill: "strength", perWeek: 6 },
  weeks_with_3_runs_streak: { kind: "weekly_run", skill: "running", perWeek: 3 },
};

/**
 * Values derived from goal history. `bySlug` maps skill ids to slugs. Window percentages
 * only exist once the history spans the full window, so a new user cannot claim
 * "30 days at 85%" on day one.
 */
export function deriveFromHistory(history: GoalRecord[], bySlug: Map<string, string>, today: DayKey): Record<string, number> {
  const doneDays = (skill: string | "*", minTier?: Tier) => {
    const days = new Map<DayKey, number>();
    for (const h of history) {
      if (h.day > today || !h.result) continue;
      if (skill !== "*" && bySlug.get(h.skillId) !== skill) continue;
      if (minTier === "standard" && h.result === "floor") continue;
      days.set(h.day, Math.max(days.get(h.day) ?? 0, VALUE[h.result]));
    }
    return days;
  };
  const firstDay = history.reduce<DayKey | null>((min, h) => (min === null || h.day < min ? h.day : min), null);

  const out: Record<string, number> = {};
  for (const [key, d] of Object.entries(DERIVED)) {
    if (d.kind === "longest_daily_run") {
      const days = [...doneDays(d.skill, d.minTier).keys()].sort();
      let best = 0;
      let run = 0;
      days.forEach((day, i) => {
        run = i > 0 && daysBetween(days[i - 1]!, day) === 1 ? run + 1 : 1;
        best = Math.max(best, run);
      });
      if (best > 0) out[key] = best;
    } else if (d.kind === "count_days") {
      const n = doneDays(d.skill).size;
      if (n > 0) out[key] = n;
    } else if (d.kind === "window_pct") {
      if (!firstDay || daysBetween(firstDay, today) < d.days - 1) continue;
      const days = doneDays(d.skill);
      let sum = 0;
      for (let i = 0; i < d.days; i++) sum += days.get(addDays(today, -i)) ?? 0;
      out[key] = (100 * sum) / d.days;
    } else {
      const perWeek = new Map<DayKey, number>();
      for (const day of doneDays(d.skill).keys()) perWeek.set(weekStart(day), (perWeek.get(weekStart(day)) ?? 0) + 1);
      const weeks = [...perWeek.keys()].sort();
      let best = 0;
      let run = 0;
      weeks.forEach((w, i) => {
        const hit = (perWeek.get(w) ?? 0) >= d.perWeek;
        const consecutive = i > 0 && daysBetween(weeks[i - 1]!, w) === 7;
        run = hit ? (consecutive && run > 0 ? run + 1 : 1) : 0;
        best = Math.max(best, run);
      });
      if (best > 0) out[key] = best;
    }
  }
  return out;
}

/** "1:44:30" for seconds; parses "1:44:30", "44:30", or plain seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatMetric(def: MetricDef | undefined, value: number): string {
  if (!def) return String(value);
  switch (def.format) {
    case "time":
      return formatDuration(value);
    case "usd":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "percent":
      return `${Math.round(value)}%`;
    default:
      return `${Number.isInteger(value) ? value : value.toFixed(value < 10 ? 2 : 1)}${def.unit ? ` ${def.unit}` : ""}`;
  }
}
