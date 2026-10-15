import { describe, expect, it } from "vitest";
import { dailyCompletion } from "./completion";
import { categories, defaultRack, rec, schedule, seedSkills } from "./fixtures";
import {
  BUDGET_FLOOR_NOTE,
  generatePlan,
  MAX_CORE_GOALS,
  NEVER_MISS_TWICE_NOTE,
  resolveDay,
  scheduledToday,
  suggestDifficulty,
  swapCandidate,
  type DayOverride,
  type PlanInput,
  type Race,
} from "./goalEngine";
import { addDays } from "./time";
import type { EngineSkill, GoalRecord } from "./types";

const MON = "2026-10-19";
const TUE = "2026-10-20";
const SAT = "2026-10-24";

function plan(
  day: string,
  opts: {
    rack?: string[];
    history?: GoalRecord[];
    skills?: EngineSkill[];
    overrides?: DayOverride[];
    races?: Race[];
    budgetMin?: number;
    assignments?: PlanInput["assignments"];
  } = {},
) {
  return generatePlan({
    resolved: resolveDay(day, schedule, opts.overrides ?? [], opts.races ?? []),
    now: new Date(`${day}T15:00:00Z`),
    budgetMin: opts.budgetMin ?? 125,
    categories,
    skills: opts.skills ?? seedSkills(),
    rack: opts.rack ?? defaultRack,
    history: opts.history ?? [],
    assignments: opts.assignments,
  });
}

const core = (p: ReturnType<typeof plan>) => p.goals.filter((g) => g.kind !== "stretch");
const bySkill = (p: ReturnType<typeof plan>, slug: string) => p.goals.find((g) => g.skillId === slug && g.kind !== "stretch");
const categoryOf = (slug: string) => seedSkills().find((s) => s.slug === slug)!.categoryId;

describe("resolveDay", () => {
  it("reads the day type from the weekly template", () => {
    expect(resolveDay(MON, schedule, [], []).dayType).toBe("class_light");
    expect(resolveDay(TUE, schedule, [], []).dayType).toBe("class_heavy");
    expect(resolveDay(SAT, schedule, [], []).dayType).toBe("weekend");
    expect(resolveDay(MON, [], [], []).dayType).toBe("class_light");
    expect(resolveDay(SAT, [], [], []).dayType).toBe("weekend");
  });

  it("applies overrides inside their inclusive range, and Travel makes the day a break", () => {
    const travel = [{ kind: "travel" as const, startsOn: MON, endsOn: TUE }];
    expect(resolveDay(TUE, schedule, travel, [])).toMatchObject({ dayType: "break", overrides: ["travel"] });
    expect(resolveDay(addDays(TUE, 1), schedule, travel, []).overrides).toEqual([]);
  });

  it("adds Race Week automatically in the 7 days before a race", () => {
    const races = [{ date: addDays(TUE, 6), label: "Half" }];
    expect(resolveDay(TUE, schedule, [], races)).toMatchObject({ daysToRace: 6, overrides: ["race_week"] });
    expect(resolveDay(addDays(TUE, -1), schedule, [], races).overrides).toEqual([]);
    expect(resolveDay(addDays(TUE, 7), schedule, [], races).daysToRace).toBeNull();
  });
});

describe("generatePlan: Jaxon's default Tuesday", () => {
  const p = plan(TUE);

  it("puts one rack goal per pinned skill scheduled today, in slot order", () => {
    expect(p.goals.filter((g) => g.kind === "rack").map((g) => g.skillId)).toEqual(defaultRack);
  });

  it("adds a balance goal from the one uncovered category, then fills the last slot within open time", () => {
    const balance = p.goals.filter((g) => g.kind === "balance");
    expect(balance.find((g) => g.reason === "Balance: Nutrition")?.skillId).toBe("food");
    // The rack uses all 125 minutes, so only a zero-minute habit fits the open slot.
    expect(balance.find((g) => g.reason === "Balance: fits open time")).toMatchObject({ skillId: "sleep", estMin: 0 });
  });

  it("fits the default rack in the 125-minute budget at Standard", () => {
    // Store 40 + Plan tomorrow 10 + Deep study 75 = 125.
    expect(bySkill(p, "academics")).toMatchObject({ tier: "standard", estMin: 75 });
    expect(p).toMatchObject({ plannedMin: 125, overBudget: false });
  });

  it("at 120 minutes downgrades the lowest-priority goal to Floor", () => {
    const tight = plan(TUE, { budgetMin: 120 });
    expect(bySkill(tight, "academics")).toMatchObject({ tier: "floor", estMin: 20, note: BUDGET_FLOOR_NOTE });
    expect(tight).toMatchObject({ plannedMin: 70, overBudget: false });
  });

  it("does not count training or zero-minute habits against the budget", () => {
    expect(bySkill(p, "strength")).toMatchObject({ tier: "standard", countsAgainstBudget: false });
    expect(bySkill(p, "running")).toMatchObject({ tier: "standard", countsAgainstBudget: false });
  });

  it("offers one optional stretch goal from the highest-priority rack goal", () => {
    const stretch = p.goals.filter((g) => g.kind === "stretch");
    expect(stretch).toHaveLength(1);
    expect(stretch[0]).toMatchObject({ skillId: "strength", tier: "stretch", text: "Full session plus a PR attempt or extra volume" });
    expect(p.goals.at(-1)!.kind).toBe("stretch");
  });

  it("carries each goal's implementation intention", () => {
    expect(bySkill(p, "time-blocking")!.intention).toBe("Before I brush my teeth, I block tomorrow in Google Calendar.");
  });

  it("is deterministic", () => {
    expect(plan(TUE)).toEqual(p);
  });
});

describe("generatePlan: scheduling", () => {
  it("skips rack skills not scheduled today (no run on Monday)", () => {
    const p = plan(MON);
    expect(bySkill(p, "running")).toBeUndefined();
    expect(core(p).filter((g) => g.kind === "rack")).toHaveLength(4);
  });

  it("pauses Academics on Travel days", () => {
    const p = plan(TUE, { overrides: [{ kind: "travel", startsOn: TUE, endsOn: TUE }] });
    expect(bySkill(p, "academics")).toBeUndefined();
  });

  it("never plans a dormant skill, and can once it is awakened", () => {
    // The rack covers every category but Athletics, so Athletics gets the one open balance slot on Monday (a Triathlon day).
    const rack = ["dropshipping", "time-blocking", "academics", "food"];
    const recent = (["strength", "sleep"] as const).map((s) => rec(s, addDays(MON, -1), "standard", "balance"));
    const scores = { strength: { score: 90 }, sleep: { score: 90 } };

    const dormant = plan(MON, { rack, history: recent, skills: seedSkills(scores) });
    expect(dormant.goals.some((g) => g.skillId === "triathlon")).toBe(false);

    const awake = plan(MON, { rack, history: recent, skills: seedSkills({ ...scores, triathlon: { status: "active" } }) });
    expect(bySkill(awake, "triathlon")?.kind).toBe("balance");
  });
});

describe("generatePlan: balance goals", () => {
  it("picks at most 2, each from a different unrepresented category, highest priority first", () => {
    const p = plan(TUE, { rack: ["ai-building", "dropshipping"] });
    const balance = p.goals.filter((g) => g.kind === "balance");
    expect(balance).toHaveLength(2);
    const cats = balance.map((g) => categoryOf(g.skillId));
    expect(new Set(cats).size).toBe(2);
    expect(cats).not.toContain("business");
    // All scores 0 and never done: priority is weight x category weight, so Strength (3 x 1.3 x lift boost) leads.
    expect(balance[0]!.skillId).toBe("strength");
    expect(balance[0]!.priority).toBeGreaterThanOrEqual(balance[1]!.priority);
  });

  it("favors low scores and long gaps", () => {
    // Only Mind is open. Time Blocking (weight 3) would win on weight alone, so it is recent and high-scoring here.
    const fresh = ["time-blocking", "meditation", "visualization"];
    const skills = seedSkills(Object.fromEntries(fresh.map((s) => [s, { score: 90 }])));
    const history = fresh.map((s) => rec(s, addDays(TUE, -1), "standard", "balance"));
    const p = plan(TUE, { rack: ["dropshipping", "strength", "academics", "food"], skills, history });
    expect(p.goals.filter((g) => g.kind === "balance" && categoryOf(g.skillId) === "mind").map((g) => g.skillId)).toEqual(["chess"]);
  });
});

describe("generatePlan: never miss twice", () => {
  const twoMisses = (slug: string, kind: GoalRecord["kind"]) => [
    rec(slug, addDays(TUE, -1), null, kind),
    rec(slug, addDays(TUE, -2), null, kind),
    rec(slug, addDays(TUE, -3), "standard", kind),
  ];

  it("drops a pinned skill missed twice to Floor with the note", () => {
    const g = bySkill(plan(TUE, { history: twoMisses("time-blocking", "rack") }), "time-blocking");
    expect(g).toMatchObject({ kind: "rack", tier: "floor", tierLocked: true, guaranteed: true, note: NEVER_MISS_TWICE_NOTE });
  });

  it("guarantees an unpinned skill a Floor slot", () => {
    const g = bySkill(plan(TUE, { history: twoMisses("chess", "balance") }), "chess");
    expect(g).toMatchObject({ kind: "balance", tier: "floor", reason: "Never miss twice", note: NEVER_MISS_TWICE_NOTE });
  });

  it("does not trigger after a single miss", () => {
    const history = [rec("chess", addDays(TUE, -1), null, "balance"), rec("chess", addDays(TUE, -3), "floor", "balance")];
    expect(bySkill(plan(TUE, { history }), "chess")).toBeUndefined();
  });

  it("counts a completed stretch goal as done that day", () => {
    const history = [...twoMisses("time-blocking", "rack"), rec("time-blocking", addDays(TUE, -1), "stretch", "stretch")];
    expect(bySkill(plan(TUE, { history }), "time-blocking")).toMatchObject({ guaranteed: false, reason: "Rack" });
  });

  it("only looks at scheduled days: Running missed Thu and Sat waits for Tuesday", () => {
    const history = [rec("running", "2026-10-15", null), rec("running", "2026-10-17", null)];
    expect(bySkill(plan(MON, { history }), "running")).toBeUndefined();
    expect(bySkill(plan(TUE, { history }), "running")).toMatchObject({ tier: "floor", guaranteed: true });
  });
});

describe("generatePlan: Canvas override", () => {
  const soon = (day: string, hours: number) => new Date(new Date(`${day}T15:00:00Z`).getTime() + hours * 3_600_000);

  it("rewrites the pinned Academics goal to start the assignment", () => {
    const p = plan(TUE, { assignments: [{ name: "Calc PS 5", dueAt: soon(TUE, 30), started: false }] });
    expect(bySkill(p, "academics")!.text).toBe("Start Calc PS 5");
    expect(bySkill(p, "academics")!.reason).toContain("Canvas");
  });

  it("replaces the lowest-priority balance goal when Academics is not pinned", () => {
    const rack = ["ai-building", "dropshipping"];
    const before = plan(TUE, { rack }).goals.filter((g) => g.kind === "balance");
    const p = plan(TUE, { rack, assignments: [{ name: "ECON essay", dueAt: soon(TUE, 47), started: false }] });
    const balance = p.goals.filter((g) => g.kind === "balance");
    expect(balance).toHaveLength(2);
    expect(balance.map((g) => g.skillId)).toContain("academics");
    expect(balance.map((g) => g.skillId)).toContain(before[0]!.skillId);
    expect(bySkill(p, "academics")!.text).toBe("Start ECON essay");
  });

  it("adds an Academics goal when there is no balance goal to replace", () => {
    // Rack covers every category, the rest is dormant, and no time is free: no balance goals at all.
    const rack = ["dropshipping", "reading", "chess", "strength", "food"];
    const others = seedSkills().filter((s) => !rack.includes(s.slug) && s.slug !== "academics");
    const skills = seedSkills(Object.fromEntries(others.map((s) => [s.slug, { status: "dormant" as const }])));
    expect(plan(TUE, { rack, skills, budgetMin: 100 }).goals.filter((g) => g.kind === "balance")).toHaveLength(0);
    const p = plan(TUE, { rack, skills, budgetMin: 100, assignments: [{ name: "Lab 6", dueAt: soon(TUE, 10), started: false }] });
    expect(bySkill(p, "academics")).toMatchObject({ kind: "balance", text: "Start Lab 6" });
  });

  it("ignores started assignments and ones due later than 48 hours", () => {
    const rack = ["ai-building", "dropshipping"];
    const p = plan(TUE, {
      rack,
      assignments: [
        { name: "Started", dueAt: soon(TUE, 5), started: true },
        { name: "Later", dueAt: soon(TUE, 49), started: false },
      ],
    });
    expect(p.goals.some((g) => g.text.startsWith("Start "))).toBe(false);
  });
});

describe("generatePlan: day overrides", () => {
  it("Exam Week: Academics to Stretch, Business and Mind to Floor, and the budget cannot undo it", () => {
    const p = plan(TUE, { overrides: [{ kind: "exam_week", startsOn: MON, endsOn: addDays(MON, 6) }] });
    expect(bySkill(p, "academics")).toMatchObject({ tier: "stretch", tierLocked: true, estMin: 120 });
    expect(bySkill(p, "dropshipping")!.tier).toBe("floor");
    expect(bySkill(p, "time-blocking")!.tier).toBe("floor");
    // 120 + 10 + 5 = 135: flagged, nothing silently dropped or downgraded.
    expect(p).toMatchObject({ plannedMin: 135, overBudget: true });
  });

  it("Exam Week adds Academics when it is not pinned", () => {
    const p = plan(TUE, { rack: ["strength"], overrides: [{ kind: "exam_week", startsOn: TUE, endsOn: TUE }] });
    expect(bySkill(p, "academics")).toMatchObject({ tier: "stretch", reason: "Exam week" });
  });

  it("Sick: every goal at Floor and no stretch goal", () => {
    const p = plan(TUE, { overrides: [{ kind: "sick", startsOn: TUE, endsOn: TUE }] });
    expect(p.goals.every((g) => g.tier === "floor")).toBe(true);
    expect(p.goals.some((g) => g.kind === "stretch")).toBe(false);
    expect(dailyCompletion(p.goals.map((g) => ({ kind: g.kind, result: "floor" as const }))).p).toBe(50);
  });

  it("Race Week: taper note on Running, leg volume note on Strength, Sleep promoted to Standard", () => {
    const p = plan(TUE, { races: [{ date: addDays(TUE, 4), label: "Half" }] });
    expect(p.overrides).toContain("race_week");
    expect(bySkill(p, "running")!.note).toContain("taper");
    expect(bySkill(p, "strength")!.note).toContain("leg volume");
    expect(bySkill(p, "sleep")).toMatchObject({ tier: "standard", tierLocked: true });
  });

  it("Race Build: Running outranks Strength in the last 4 weeks, with the leg volume cut in the last 3", () => {
    const build = plan(TUE, { races: [{ date: addDays(TUE, 20), label: "Half" }] });
    expect(build.raceBuild).toBe(true);
    expect(build.goals.find((g) => g.kind === "stretch")!.skillId).toBe("running");
    expect(bySkill(build, "strength")!.note).toContain("50%");

    const early = plan(TUE, { races: [{ date: addDays(TUE, 25), label: "Half" }] });
    expect(early.raceBuild).toBe(true);
    expect(bySkill(early, "strength")!.note).toBeNull();
  });
});

describe("generatePlan: limits", () => {
  it("downgrades to Floor and flags over-budget without dropping goals", () => {
    const normal = plan(TUE);
    const tight = plan(TUE, { budgetMin: 10 });
    expect(core(tight)).toHaveLength(core(normal).length);
    expect(tight.goals.filter((g) => g.countsAgainstBudget && g.kind !== "stretch").every((g) => g.tier === "floor")).toBe(true);
    expect(tight).toMatchObject({ plannedMin: 10 + 5 + 20, overBudget: true });
  });

  it("fills the open slot at Standard when there is time, at Floor when only Floor fits", () => {
    // Free time after the rack: 75 minutes, then 15. AI Building is the top remaining candidate.
    expect(bySkill(plan(TUE, { budgetMin: 200 }), "ai-building")).toMatchObject({ tier: "standard", reason: "Balance: fits open time" });
    expect(bySkill(plan(TUE, { budgetMin: 140 }), "ai-building")).toMatchObject({ tier: "floor", note: BUDGET_FLOOR_NOTE });
  });

  it("never pushes another goal down to make room for the fill", () => {
    const p = plan(TUE, { budgetMin: 130 });
    expect(p.goals.filter((g) => g.kind === "rack").every((g) => g.tier === "standard")).toBe(true);
    expect(p.plannedMin).toBeLessThanOrEqual(130);
  });

  it("caps core goals at 7 plus 1 stretch, keeping every rack goal", () => {
    const misses = ["chess", "meditation", "visualization", "reading", "college-integration", "ai-building"].flatMap((s) => [
      rec(s, addDays(TUE, -1), null, "balance"),
      rec(s, addDays(TUE, -2), null, "balance"),
    ]);
    const p = plan(TUE, { history: misses });
    expect(core(p)).toHaveLength(MAX_CORE_GOALS);
    expect(p.goals.filter((g) => g.kind === "stretch").length).toBeLessThanOrEqual(1);
    expect(p.goals.filter((g) => g.kind === "rack")).toHaveLength(5);
  });

  it("ignores history entries dated today or later", () => {
    const history = [rec("time-blocking", TUE, null), rec("time-blocking", addDays(TUE, -1), null)];
    expect(bySkill(plan(TUE, { history }), "time-blocking")!.tier).toBe("standard");
  });
});

describe("suggestDifficulty", () => {
  const days = (n: number, result: GoalRecord["result"]) =>
    Array.from({ length: n }, (_, i) => rec("chess", addDays(TUE, -(i + 1)), result, "balance"));

  it("suggests leveling up after Standard or better on 7 of the last 7 scheduled days", () => {
    expect(suggestDifficulty("chess:0", days(7, "standard"), TUE)).toMatchObject({ kind: "level_up", message: "You've crushed this. Level it up?" });
    expect(suggestDifficulty("chess:0", [...days(6, "standard"), rec("chess", addDays(TUE, -7), "floor", "balance")], TUE)).toBeNull();
  });

  it("suggests easing under 60% over 14 days, only with enough data", () => {
    expect(suggestDifficulty("chess:0", days(6, "floor"), TUE)).toMatchObject({ kind: "ease", message: expect.stringContaining("50%") });
    expect(suggestDifficulty("chess:0", days(3, null), TUE)).toBeNull();
    expect(suggestDifficulty("chess:0", [], TUE)).toBeNull();
  });
});

describe("swapCandidate", () => {
  const input = (day: string): PlanInput => ({
    resolved: resolveDay(day, schedule, [], []),
    now: new Date(`${day}T15:00:00Z`),
    budgetMin: 125,
    categories,
    skills: seedSkills(),
    rack: defaultRack,
    history: [],
  });
  const current = (day: string) => generatePlan(input(day)).goals.filter((g) => g.kind !== "stretch");

  it("swaps a zero-minute habit for the next zero-minute habit when no time is free", () => {
    const g = swapCandidate(input(TUE), current(TUE), "food");
    expect(g).toMatchObject({ skillId: "gut-health", kind: "balance", reason: "Swapped in" });
  });

  it("uses the time the removed goal frees, dropping to Floor when only Floor fits", () => {
    // Removing Store work (40 min) frees 40: AI Building (45) fits only at Floor (15).
    const g = swapCandidate(input(TUE), current(TUE), "dropshipping");
    expect(g).toMatchObject({ skillId: "ai-building", tier: "floor", estMin: 15, note: BUDGET_FLOOR_NOTE });
  });

  it("returns null when every scheduled skill is already planned", () => {
    const all = seedSkills().map((s) => ({ skillId: s.id, estMin: 0, countsAgainstBudget: false }));
    expect(swapCandidate(input(TUE), all, "food")).toBeNull();
  });

  it("scheduledToday follows weekdays, day types, and status", () => {
    const skills = seedSkills();
    const running = skills.find((s) => s.slug === "running")!;
    expect(scheduledToday({ resolved: resolveDay(TUE, schedule, [], []) }, running)?.name).toBe("Planned run");
    expect(scheduledToday({ resolved: resolveDay(MON, schedule, [], []) }, running)).toBeUndefined();
    const triathlon = skills.find((s) => s.slug === "triathlon")!;
    expect(scheduledToday({ resolved: resolveDay(MON, schedule, [], []) }, triathlon)).toBeUndefined();
  });
});
