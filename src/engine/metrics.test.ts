import { describe, expect, it } from "vitest";
import { SEED_TEMPLATE } from "@/seed/template";
import { rec } from "./fixtures";
import { aggregateEntries, DERIVED, deriveFromHistory, formatDuration, formatMetric, METRIC_BY_KEY, METRIC_DEFS, parseDuration } from "./metrics";
import { milestonesToClaim } from "./scoring";
import { addDays } from "./time";

const TODAY = "2026-10-15";
const slugs = new Map(SEED_TEMPLATE.categories.flatMap((c) => c.skills.map((s) => [s.slug, s.slug] as const)));

describe("manual entries", () => {
  it("aggregates by each key's rule", () => {
    const v = aggregateEntries([
      { key: "bench_1rm", value: 240, day: "2026-10-01" },
      { key: "bench_1rm", value: 235, day: "2026-10-08" },
      { key: "bodyweight_lb", value: 183, day: "2026-10-01" },
      { key: "bodyweight_lb", value: 184.5, day: "2026-10-08" },
      { key: "half_marathon_best_s", value: 6400, day: "2027-01-09" },
      { key: "half_marathon_best_s", value: 6250, day: "2027-03-01" },
      { key: "books_finished", value: 1, day: "2026-09-01" },
      { key: "books_finished", value: 1, day: "2026-10-01" },
    ]);
    expect(v).toMatchObject({ bench_1rm: 240, bodyweight_lb: 184.5, half_marathon_best_s: 6250, books_finished: 2 });
  });

  it("derives revenue, GPA, and chess counters", () => {
    const v = aggregateEntries([
      { key: "revenue_month_usd", value: 400, day: "2027-01-31" },
      { key: "revenue_month_usd", value: 10_500, day: "2027-02-28" },
      { key: "revenue_month_usd", value: 12_000, day: "2027-03-31" },
      { key: "semester_gpa", value: 3.8, day: "2026-12-20" },
      { key: "semester_gpa", value: 4.0, day: "2027-05-15" },
      { key: "chess_rating", value: 1000, day: "2026-10-01" },
    ]);
    expect(v).toMatchObject({
      revenue_total_usd: 22_900,
      revenue_best_month_usd: 12_000,
      revenue_10k_month_streak: 2,
      first_semester_gpa: 3.8,
      best_semester_gpa: 4,
      semesters_at_4_0: 1,
      chess_ratings_recorded: 1,
    });
  });

  it("treats the first reading test as the baseline", () => {
    const v = aggregateEntries([
      { key: "reading_effective_rate", value: 300, day: "2026-10-01" },
      { key: "reading_effective_rate", value: 345, day: "2026-10-15" },
    ]);
    expect(v).toMatchObject({ reading_tests_taken: 2, effective_rate_gain_pct: 15 });
    expect(aggregateEntries([{ key: "reading_effective_rate", value: 300, day: "2026-10-01" }]).effective_rate_gain_pct).toBeUndefined();
  });

  it("rolls weekly revenue into months", () => {
    const v = aggregateEntries([
      { key: "revenue_week_usd", value: 3000, day: "2027-03-07" },
      { key: "revenue_week_usd", value: 3500, day: "2027-03-14" },
      { key: "revenue_month_usd", value: 4000, day: "2027-03-31" },
      { key: "revenue_week_usd", value: 200, day: "2027-04-04" },
    ]);
    expect(v).toMatchObject({ revenue_total_usd: 10_700, revenue_best_month_usd: 10_500, revenue_10k_month_streak: 1 });
  });

  it("feeds auto-claim: bench 255 claims Bench 255 but not 275", () => {
    const strength = SEED_TEMPLATE.categories.flatMap((c) => c.skills).find((s) => s.slug === "strength")!;
    const ms = strength.milestones.map((m, i) => ({ id: m.title, points: m.points, claimed: i < 2, rule: m.rule ?? null }));
    expect(milestonesToClaim(ms, aggregateEntries([{ key: "bench_1rm", value: 255, day: TODAY }]))).toEqual(["Bench 255"]);
  });
});

describe("derived from goal history", () => {
  const daily = (skill: string, n: number, result: "floor" | "standard" | null = "standard", endOffset = 0) =>
    Array.from({ length: n }, (_, i) => rec(skill, addDays(TODAY, -(i + endOffset)), result));

  it("finds the longest run of consecutive done days", () => {
    const history = [...daily("meditation", 5), ...daily("meditation", 8, "standard", 7)];
    expect(deriveFromHistory(history, slugs, TODAY).meditation_streak_days).toBe(8);
  });

  it("counts any completion for app use, but only Standard+ where required", () => {
    const history = [...daily("sleep", 4, "floor")];
    const v = deriveFromHistory(history, slugs, TODAY);
    expect(v.app_use_streak_days).toBe(4);
    expect(v.sleep_logged_days).toBe(4);
    expect(v.sleep_in_window_streak).toBeUndefined();
  });

  it("only reports window percentages once history spans the window", () => {
    expect(deriveFromHistory(daily("meditation", 10), slugs, TODAY).meditation_30d_pct).toBeUndefined();
    const v = deriveFromHistory([...daily("meditation", 27), ...daily("meditation", 3, "floor", 27)], slugs, TODAY);
    expect(v.meditation_30d_pct).toBeCloseTo(((27 + 1.5) / 30) * 100);
  });

  it("counts consecutive weeks hitting a weekly target", () => {
    // Mon 2026-09-28 .. Sat: 6 sessions; next week 6; then 5.
    const week = (mon: string, n: number) => Array.from({ length: n }, (_, i) => rec("strength", addDays(mon, i), "standard"));
    const history = [...week("2026-09-28", 6), ...week("2026-10-05", 6), ...week("2026-10-12", 4)];
    expect(deriveFromHistory(history, slugs, TODAY).weeks_with_6_sessions_streak).toBe(2);
  });
});

describe("definitions", () => {
  it("covers every seeded auto-claim key, except ones that need integrations", () => {
    const derivedFromEntries = ["reading_tests_taken", "effective_rate_gain_pct", "revenue_total_usd", "revenue_best_month_usd", "revenue_10k_month_streak", "first_semester_gpa", "best_semester_gpa", "semesters_at_4_0", "chess_ratings_recorded"];
    const known = new Set([...METRIC_DEFS.map((d) => d.key), ...Object.keys(DERIVED), ...derivedFromEntries]);
    const pending = ["on_time_streak_days", "sleep_avg_hours_14d", "sleep_months_without_sub6", "sleep_in_window_semester_pct", "protein_target_days_7d", "fuel_targets_semester_pct", "fiber_30g_days_7d", "gut_habits_semester_pct", "adherence_70_streak_days", "adherence_80_streak_days", "adherence_85_streak_days", "planned_nights_semester_pct", "weekly_planning_streak_weeks"];
    const keys = SEED_TEMPLATE.categories.flatMap((c) => c.skills.flatMap((s) => s.milestones.flatMap((m) => (m.rule ? [m.rule.key] : []))));
    const missing = [...new Set(keys)].filter((k) => !known.has(k) && !pending.includes(k));
    expect(missing).toEqual([]);
  });

  it("formats and parses values", () => {
    expect(formatDuration(6299)).toBe("1:44:59");
    expect(formatDuration(1830)).toBe("30:30");
    expect(parseDuration("1:44:59")).toBe(6299);
    expect(parseDuration("44:30")).toBe(2670);
    expect(parseDuration("abc")).toBeNull();
    expect(formatMetric(METRIC_BY_KEY.get("bench_1rm"), 240)).toBe("240 lb");
    expect(formatMetric(METRIC_BY_KEY.get("revenue_month_usd"), 1234.4)).toBe("$1,234");
    expect(formatMetric(METRIC_BY_KEY.get("semester_gpa"), 3.857)).toBe("3.86");
    expect(formatMetric(undefined, 7)).toBe("7");
  });
});
