import { describe, expect, it } from "vitest";
import { categories, rec, seedSkills } from "./fixtures";
import {
  buildSnapshots,
  categoryScore,
  consistency,
  figureTier,
  isNeglected,
  levelScore,
  milestonesToClaim,
  overallScore,
  regionOpacity,
  scoreBreakdown,
  tipTier,
  tipTierUnlocked,
  trend,
} from "./scoring";
import { addDays } from "./time";
import type { Tier } from "./types";

const TODAY = "2026-10-15";
/** One goal per day for the last n days before today (d = 1..n). */
const lastDays = (n: number, result: Tier | null, skill = "x") =>
  Array.from({ length: n }, (_, i) => rec(skill, addDays(TODAY, -(i + 1)), result));

describe("level (L)", () => {
  it("sums claimed points and caps at 100", () => {
    expect(levelScore([{ points: 8, claimed: true }, { points: 7, claimed: false }, { points: 13, claimed: true }])).toBe(21);
    expect(levelScore([{ points: 60, claimed: true }, { points: 60, claimed: true }])).toBe(100);
  });

  it("is never reduced by misses", () => {
    const ms = [{ points: 30, claimed: true }];
    expect(scoreBreakdown(ms, lastDays(28, "standard"), TODAY).level).toBe(30);
    expect(scoreBreakdown(ms, lastDays(28, null), TODAY).level).toBe(30);
  });

  it("flags a skill at the ceiling", () => {
    expect(scoreBreakdown([{ points: 100, claimed: true }], [], TODAY).atCeiling).toBe(true);
    expect(scoreBreakdown([{ points: 99, claimed: true }], [], TODAY).atCeiling).toBe(false);
  });
});

describe("consistency (C)", () => {
  it("is 100 when every scheduled day is done, 0 when every one is missed", () => {
    expect(consistency(lastDays(27, "standard"), TODAY).value).toBeCloseTo(100);
    expect(consistency(lastDays(27, null), TODAY).value).toBeCloseTo(0);
  });

  it("caps Stretch at 1.0 and counts Floor as 0.5", () => {
    expect(consistency(lastDays(20, "stretch"), TODAY).value).toBeCloseTo(100);
    expect(consistency(lastDays(20, "floor"), TODAY).value).toBeCloseTo(50);
  });

  it("skips unscheduled days instead of counting them as misses", () => {
    // Runs on Tue/Thu/Sat only, all done: 100, not 3/7.
    const runs = Array.from({ length: 27 }, (_, i) => addDays(TODAY, -(i + 1)))
      .filter((d) => [2, 4, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))
      .map((d) => rec("running", d, "standard"));
    expect(runs.length).toBeGreaterThanOrEqual(7);
    expect(consistency(runs, TODAY).value).toBeCloseTo(100);
  });

  it("weights by 0.95^d on the calendar day offset", () => {
    // 8 scheduled days (no cold start): done on d=1..7, missed on d=10.
    const goals = [...lastDays(7, "standard"), rec("x", addDays(TODAY, -10), null)];
    const done = [1, 2, 3, 4, 5, 6, 7].reduce((s, d) => s + 0.95 ** d, 0);
    expect(consistency(goals, TODAY).value).toBeCloseTo((100 * done) / (done + 0.95 ** 10), 6);
  });

  it("collapses several goals for one skill on one day to the best result", () => {
    const d = addDays(TODAY, -1);
    // d=1 has a missed rack goal but a completed stretch goal for the same skill.
    const goals = [...lastDays(8, "standard").slice(1), rec("x", d, null), rec("x", d, "stretch", "stretch")];
    expect(consistency(goals, TODAY)).toMatchObject({ value: expect.closeTo(100), n: 8 });
  });

  it("does not count today until it is logged", () => {
    expect(consistency([...lastDays(10, "standard"), rec("x", TODAY, null)], TODAY).value).toBeCloseTo(100);
    expect(consistency([...lastDays(10, null), rec("x", TODAY, "standard")], TODAY).n).toBe(11);
  });

  it("ignores days outside the 28-day window and future days", () => {
    const old = rec("x", addDays(TODAY, -28), null);
    const future = rec("x", addDays(TODAY, 1), null);
    expect(consistency([...lastDays(10, "standard"), old, future], TODAY).value).toBeCloseTo(100);
  });

  it("blends toward 50 with fewer than 7 scheduled days (cold start)", () => {
    expect(consistency([], TODAY)).toEqual({ value: 50, raw: null, n: 0 });
    expect(consistency(lastDays(3, "standard"), TODAY).value).toBeCloseTo((3 / 7) * 100 + (4 / 7) * 50);
    expect(consistency(lastDays(7, "standard"), TODAY).value).toBeCloseTo(100);
  });

  it("neglect costs at most 30 points and never touches L", () => {
    const ms = [{ points: 40, claimed: true }];
    const best = scoreBreakdown(ms, lastDays(27, "standard"), TODAY).score;
    const worst = scoreBreakdown(ms, lastDays(27, null), TODAY).score;
    expect(best - worst).toBeCloseTo(30);
    expect(worst).toBeCloseTo(28); // 0.7 x 40
  });

  it("recovers most of the way in about two weeks", () => {
    const goals = [...lastDays(14, "standard"), ...lastDays(27, null).slice(14)];
    expect(consistency(goals, TODAY).value).toBeGreaterThan(65);
  });
});

describe("category and overall", () => {
  it("weights skills by priority and excludes dormant and archived skills", () => {
    const skills = [
      { status: "active" as const, priorityWeight: 3, score: 60 },
      { status: "active" as const, priorityWeight: 1, score: 20 },
      { status: "dormant" as const, priorityWeight: 1, score: 0 },
      { status: "archived" as const, priorityWeight: 3, score: 100 },
    ];
    expect(categoryScore(skills)).toBeCloseTo((3 * 60 + 20) / 4);
    expect(categoryScore([{ status: "dormant", priorityWeight: 1, score: 50 }])).toBeNull();
  });

  it("dormant Triathlon does not move the Athletics score", () => {
    const athletics = seedSkills().filter((s) => s.categoryId === "athletics");
    const withScores = (tri: number) =>
      athletics.map((s) => ({ status: s.status, priorityWeight: s.priorityWeight, score: s.slug === "triathlon" ? tri : 50 }));
    expect(categoryScore(withScores(0))).toBe(categoryScore(withScores(100)));
  });

  it("averages categories equally", () => {
    expect(overallScore([100, 0, 50, 50, 50])).toBe(50);
    expect(overallScore([80, null, 40])).toBe(60);
    expect(overallScore([])).toBe(0);
  });
});

describe("tiers and visuals", () => {
  it("maps the overall score to figure tiers using the displayed (rounded) number", () => {
    expect(figureTier(0).name).toBe("Raw");
    expect(figureTier(19.4).name).toBe("Raw");
    expect(figureTier(19.6).name).toBe("Awakened");
    expect(figureTier(47).name).toBe("Forged");
    expect(figureTier(60).numeral).toBe("IV");
    expect(figureTier(79.4).name).toBe("Ascendant");
    expect(figureTier(80).name).toBe("Sovereign");
    expect(figureTier(100).tier).toBe(5);
  });

  it("maps skill scores to tip tiers and detects upward crossings only", () => {
    expect(tipTier(33.4)).toBe("foundation");
    expect(tipTier(34)).toBe("development");
    expect(tipTier(66.4)).toBe("development");
    expect(tipTier(67)).toBe("mastery");
    expect(tipTierUnlocked(30, 35)).toBe("development");
    expect(tipTierUnlocked(60, 70)).toBe("mastery");
    expect(tipTierUnlocked(20, 90)).toBe("mastery");
    expect(tipTierUnlocked(35, 30)).toBeNull();
    expect(tipTierUnlocked(40, 50)).toBeNull();
  });

  it("drives region vein opacity from the category score", () => {
    expect(regionOpacity(0)).toBeCloseTo(0.15);
    expect(regionOpacity(50)).toBeCloseTo(0.575);
    expect(regionOpacity(100)).toBeCloseTo(1);
    expect(regionOpacity(140)).toBeCloseTo(1);
  });

  it("marks active skills neglected after 7 days without a completion", () => {
    const base = { status: "active" as const, activeSince: "2026-09-01" };
    expect(isNeglected({ ...base, lastDone: "2026-10-08" }, TODAY)).toBe(true);
    expect(isNeglected({ ...base, lastDone: "2026-10-09" }, TODAY)).toBe(false);
    expect(isNeglected({ ...base, lastDone: null }, TODAY)).toBe(true);
    expect(isNeglected({ status: "active", lastDone: null, activeSince: "2026-10-12" }, TODAY)).toBe(false);
    expect(isNeglected({ status: "dormant", lastDone: null, activeSince: "2026-01-01" }, TODAY)).toBe(false);
  });

  it("shows a trend arrow only beyond 2 points", () => {
    expect(trend(49.1, 47)).toEqual({ delta: expect.closeTo(2.1), arrow: "up" });
    expect(trend(45, 47).arrow).toBeNull();
    expect(trend(40, 47).arrow).toBe("down");
    expect(trend(40, null)).toEqual({ delta: null, arrow: null });
  });
});

describe("milestone auto-claim", () => {
  const ms = [
    { id: "b255", points: 7, claimed: false, rule: { key: "bench_1rm", op: "gte" as const, value: 255 } },
    { id: "b225", points: 8, claimed: true, rule: { key: "bench_1rm", op: "gte" as const, value: 225 } },
    { id: "half", points: 10, claimed: false, rule: { key: "half_marathon_best_s", op: "lte" as const, value: 6299 } },
    { id: "manual", points: 5, claimed: false, rule: null },
    { id: "chess", points: 8, claimed: false, rule: { key: "chess_rating", op: "gte" as const, value: 1100 } },
  ];

  it("claims rules that are met, skipping claimed, manual, and unknown values", () => {
    expect(milestonesToClaim(ms, { bench_1rm: 255, half_marathon_best_s: 6290 })).toEqual(["b255", "half"]);
    expect(milestonesToClaim(ms, { bench_1rm: 254, half_marathon_best_s: 6300, chess_rating: Number.NaN })).toEqual([]);
  });
});

describe("snapshots", () => {
  it("writes one row per active skill, per category, and overall", () => {
    const skills = seedSkills().map((s, i) => ({
      id: s.id,
      categoryId: s.categoryId,
      status: s.status,
      priorityWeight: s.priorityWeight,
      breakdown: { score: i * 5, level: i * 5, consistency: 50 },
    }));
    const rows = buildSnapshots(TODAY, categories.map((c) => c.id), skills);
    expect(rows.filter((r) => r.scope === "skill")).toHaveLength(14);
    expect(rows.filter((r) => r.scope === "category")).toHaveLength(5);
    const overall = rows.find((r) => r.scope === "overall")!;
    const cats = rows.filter((r) => r.scope === "category").map((r) => r.score);
    expect(overall.score).toBeCloseTo(cats.reduce((a, b) => a + b, 0) / 5);
    expect(rows.find((r) => r.refId === "triathlon")).toBeUndefined();
  });
});
