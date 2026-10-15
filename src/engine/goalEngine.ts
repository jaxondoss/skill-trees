import { daysBetween, weekday } from "./time";
import type {
  DayKey,
  DayType,
  EngineCategory,
  EngineNonNegotiable,
  EngineSkill,
  GoalKind,
  GoalRecord,
  OverrideKind,
  Tier,
} from "./types";

/** Skills with special engine behavior, identified by slug (slugs survive renames). */
export const ROLE_SLUGS = {
  academics: "academics",
  running: "running",
  strength: "strength",
  sleep: "sleep",
} as const;

export const MAX_CORE_GOALS = 7;
export const MAX_BALANCE_GOALS = 2;
export const DAYS_SINCE_CAP = 28;
export const RACE_BUILD_DAYS = 28;
export const LEG_VOLUME_CUT_DAYS = 21;
export const RACE_WEEK_DAYS = 7;
export const CANVAS_WINDOW_HOURS = 48;
export const NEVER_MISS_TWICE_NOTE = "Get back on it. Floor counts.";

// ───────────────────────────── Day resolution

export type ScheduleDay = { weekday: number; dayType: DayType };
export type DayOverride = { kind: OverrideKind; startsOn: DayKey; endsOn: DayKey };
export type Race = { date: DayKey; label: string };

export type ResolvedDay = {
  day: DayKey;
  dayType: DayType;
  overrides: OverrideKind[];
  /** Days until the next race, or null if none is scheduled. */
  daysToRace: number | null;
};

/**
 * Today's day type from the weekly template, plus active overrides.
 * Race Week is added automatically in the 7 days up to a race; Travel turns the day into a break.
 */
export function resolveDay(day: DayKey, schedule: ScheduleDay[], overrides: DayOverride[], races: Race[]): ResolvedDay {
  const wd = weekday(day);
  let dayType: DayType = schedule.find((s) => s.weekday === wd)?.dayType ?? (wd === 0 || wd === 6 ? "weekend" : "class_light");

  const active = new Set(overrides.filter((o) => o.startsOn <= day && day <= o.endsOn).map((o) => o.kind));
  const upcoming = races.map((r) => daysBetween(day, r.date)).filter((d) => d >= 0);
  const daysToRace = upcoming.length ? Math.min(...upcoming) : null;
  if (daysToRace !== null && daysToRace < RACE_WEEK_DAYS) active.add("race_week");
  if (active.has("travel")) dayType = "break";

  return { day, dayType, overrides: [...active].sort(), daysToRace };
}

// ───────────────────────────── Plan

export type Assignment = { name: string; dueAt: Date; started: boolean };

export type PlanInput = {
  resolved: ResolvedDay;
  /** Current instant, for the Canvas 48-hour window. */
  now: Date;
  budgetMin: number;
  categories: EngineCategory[];
  skills: EngineSkill[];
  /** Pinned skill ids in slot order. */
  rack: string[];
  /** Past goal outcomes. Entries for today or later are ignored. */
  history: GoalRecord[];
  assignments?: Assignment[];
};

export type PlannedGoal = {
  skillId: string;
  nonNegotiableId: string;
  kind: GoalKind;
  tier: Tier;
  title: string;
  text: string;
  estMin: number;
  countsAgainstBudget: boolean;
  intention: string;
  priority: number;
  /** Why the engine chose this goal ("Rack", "Never miss twice", "Balance: Mind"). */
  reason: string;
  note: string | null;
  /** Tier set by never-miss-twice or a day override. Budget downgrades leave it alone. */
  tierLocked: boolean;
  /** Never-miss-twice slot: not dropped by the cap or the Canvas override. */
  guaranteed: boolean;
};

export type Plan = {
  day: DayKey;
  dayType: DayType;
  overrides: OverrideKind[];
  raceBuild: boolean;
  goals: PlannedGoal[];
  budgetMin: number;
  /** Minutes of core goals that count against the budget. */
  plannedMin: number;
  /** Still over budget with every downgradable goal at Floor. Nothing is dropped silently. */
  overBudget: boolean;
};

type Draft = Omit<PlannedGoal, "text" | "estMin" | "note"> & {
  nn: EngineNonNegotiable;
  textOverride: string | null;
  notes: string[];
};

/** Builds today's plan (spec 7.2). Deterministic for the same input. */
export function generatePlan(input: PlanInput): Plan {
  const { resolved, categories, skills, rack } = input;
  const today = resolved.day;
  const wd = weekday(today);
  const has = (k: OverrideKind) => resolved.overrides.includes(k);
  const raceBuild = resolved.daysToRace !== null && resolved.daysToRace < RACE_BUILD_DAYS;

  const catById = new Map(categories.map((c) => [c.id, c]));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const pinned = new Set(rack);
  const history = input.history.filter((h) => h.day < today);

  const lastDone = new Map<string, DayKey>();
  for (const h of history) {
    if (h.result && (lastDone.get(h.skillId) ?? "") < h.day) lastDone.set(h.skillId, h.day);
  }

  const scheduledNN = (s: EngineSkill) =>
    s.status === "active"
      ? s.nonNegotiables.find((n) => n.daysOfWeek.includes(wd) && (!n.dayTypes || n.dayTypes.includes(resolved.dayType)))
      : undefined;

  const priorityOf = (s: EngineSkill): number => {
    const last = lastDone.get(s.id);
    const since = last ? Math.min(DAYS_SINCE_CAP, daysBetween(last, today)) : DAYS_SINCE_CAP;
    const score = Math.max(0, Math.min(100, s.score));
    let p = s.priorityWeight * (catById.get(s.categoryId)?.goalWeight ?? 1) * (1 + since / 7) * (1 + (100 - score) / 100);
    // Lifting has priority until 4 weeks before a race, then running does.
    if (s.slug === ROLE_SLUGS.running) p *= raceBuild ? 1.25 : 0.8;
    if (s.slug === ROLE_SLUGS.strength) p *= raceBuild ? 0.8 : 1.25;
    return p;
  };

  const draft = (s: EngineSkill, nn: EngineNonNegotiable, kind: GoalKind, tier: Tier, reason: string): Draft => ({
    skillId: s.id,
    nonNegotiableId: nn.id,
    kind,
    tier,
    title: nn.name,
    countsAgainstBudget: nn.countsAgainstBudget,
    intention: nn.intention,
    priority: priorityOf(s),
    reason,
    tierLocked: false,
    guaranteed: false,
    nn,
    textOverride: null,
    notes: [],
  });

  const goals: Draft[] = [];
  const goalFor = (skillId: string | undefined) => goals.find((g) => g.skillId === skillId && g.kind !== "stretch");

  // 1. Rack goals: one per pinned skill scheduled today.
  for (const id of rack) {
    const s = skillById.get(id);
    const nn = s && scheduledNN(s);
    if (s && nn) goals.push(draft(s, nn, "rack", nn.defaultTier, "Rack"));
  }

  // 2. Never miss twice: missed on its last 2 scheduled days means a guaranteed Floor slot.
  for (const s of skills) {
    const nn = scheduledNN(s);
    if (!nn || !missedLastTwo(nn.id, history)) continue;
    const g = goalFor(s.id) ?? goals[goals.push(draft(s, nn, "balance", "floor", "")) - 1]!;
    g.tier = "floor";
    g.tierLocked = true;
    g.guaranteed = true;
    g.reason = g.kind === "rack" ? "Rack. Never miss twice" : "Never miss twice";
    g.notes.push(NEVER_MISS_TWICE_NOTE);
  }

  // 3. Balance goals: top candidates from categories not yet represented, up to 2 in total.
  const represented = new Set(goals.map((g) => skillById.get(g.skillId)?.categoryId));
  let slots = MAX_BALANCE_GOALS - goals.filter((g) => g.kind === "balance").length;
  const candidates = skills
    .filter((s) => !pinned.has(s.id) && !goalFor(s.id))
    .flatMap((s) => {
      const nn = scheduledNN(s);
      return nn ? [{ s, nn, priority: priorityOf(s) }] : [];
    })
    .sort((a, b) => b.priority - a.priority || a.s.slug.localeCompare(b.s.slug));
  for (const c of candidates) {
    if (slots <= 0) break;
    if (represented.has(c.s.categoryId)) continue;
    goals.push(draft(c.s, c.nn, "balance", c.nn.defaultTier, `Balance: ${catById.get(c.s.categoryId)?.name ?? "category"}`));
    represented.add(c.s.categoryId);
    slots -= 1;
  }

  // 4. Canvas override: an unstarted assignment due within 48 hours becomes an Academics goal.
  //    A real deadline wins over the template, so this applies on break days too.
  const academics = skills.find((s) => s.slug === ROLE_SLUGS.academics && s.status === "active");
  const due = (input.assignments ?? [])
    .filter((a) => !a.started && a.dueAt.getTime() - input.now.getTime() <= CANVAS_WINDOW_HOURS * 3_600_000)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
  if (due && academics) {
    const text = `Start ${due.name}`;
    const existing = goalFor(academics.id);
    if (existing) {
      existing.textOverride = text;
      existing.reason += ". Canvas: due within 48 hours";
    } else {
      const nn = scheduledNN(academics) ?? academics.nonNegotiables[0];
      if (nn) {
        const g = draft(academics, nn, "balance", "standard", "Canvas: due within 48 hours");
        g.textOverride = text;
        const replaceable = goals
          .filter((x) => x.kind === "balance" && !x.guaranteed)
          .sort((a, b) => a.priority - b.priority)[0];
        if (replaceable) goals[goals.indexOf(replaceable)] = g;
        else goals.push(g);
      }
    }
  }

  // 5. Day types and overrides (spec 7.3), applied as tier transforms.
  const categorySlug = (g: Draft) => catById.get(skillById.get(g.skillId)?.categoryId ?? "")?.slug;
  const lockTier = (g: Draft, tier: Tier) => {
    g.tier = tier;
    g.tierLocked = true;
  };
  const ensureGoal = (s: EngineSkill | undefined, reason: string): Draft | undefined => {
    if (!s || s.status !== "active") return undefined;
    const existing = goalFor(s.id);
    if (existing) return existing;
    const nn = scheduledNN(s) ?? s.nonNegotiables[0];
    if (!nn) return undefined;
    const g = draft(s, nn, "balance", nn.defaultTier, reason);
    goals.push(g);
    return g;
  };
  const bySlug = (slug: string) => skills.find((s) => s.slug === slug);

  if (has("exam_week")) {
    const g = ensureGoal(academics, "Exam week");
    if (g) lockTier(g, "stretch");
    for (const x of goals) if (categorySlug(x) === "business" || categorySlug(x) === "mind") lockTier(x, "floor");
  }
  if (has("race_week")) {
    for (const x of goals) {
      const slug = skillById.get(x.skillId)?.slug;
      if (slug === ROLE_SLUGS.running) x.notes.push("Race week: follow the taper plan.");
      if (slug === ROLE_SLUGS.strength) x.notes.push("Race week: reduce leg volume.");
    }
    const sleep = ensureGoal(bySlug(ROLE_SLUGS.sleep), "Race week: protect sleep");
    if (sleep) lockTier(sleep, sleep.tier === "floor" ? "standard" : sleep.tier);
  } else if (raceBuild && resolved.daysToRace! < LEG_VOLUME_CUT_DAYS) {
    for (const x of goals)
      if (skillById.get(x.skillId)?.slug === ROLE_SLUGS.strength) x.notes.push("Race build: cut leg volume about 50%.");
  }
  if (has("sick")) {
    for (const x of goals) lockTier(x, "floor");
  }

  // 6. Cap: at most 7 core goals. Rack goals are never dropped; balance goals go lowest priority first.
  while (goals.length > MAX_CORE_GOALS) {
    const victim = goals
      .filter((g) => g.kind === "balance")
      .sort((a, b) => Number(a.guaranteed) - Number(b.guaranteed) || a.priority - b.priority)[0];
    if (!victim) break;
    goals.splice(goals.indexOf(victim), 1);
  }

  // 7. Time budget: downgrade lowest-priority goals to Floor until the plan fits.
  const minutesOf = (g: Draft) => g.nn.minutes[g.tier];
  const used = () => goals.reduce((sum, g) => sum + (g.countsAgainstBudget ? minutesOf(g) : 0), 0);
  const downgradeOrder = [
    ...goals.filter((g) => g.kind === "balance").sort((a, b) => a.priority - b.priority),
    ...goals.filter((g) => g.kind === "rack").sort((a, b) => a.priority - b.priority),
  ];
  for (const g of downgradeOrder) {
    if (used() <= input.budgetMin) break;
    if (!g.countsAgainstBudget || g.tierLocked || g.tier === "floor") continue;
    g.tier = "floor";
    g.notes.push("Floor to fit today's time budget.");
  }
  const plannedMin = used();

  // 8. Stretch (optional): the highest-priority rack goal at Stretch tier, outside the denominator.
  const stretchFrom = goals
    .filter((g) => g.kind === "rack" && g.tier === "standard" && !g.tierLocked)
    .sort((a, b) => b.priority - a.priority)[0];
  const stretch: Draft[] = stretchFrom
    ? [{ ...stretchFrom, kind: "stretch", tier: "stretch", reason: "Stretch (optional)", textOverride: null, notes: [] }]
    : [];

  const rackOrder = (g: Draft) => rack.indexOf(g.skillId);
  const core = [
    ...goals.filter((g) => g.kind === "rack").sort((a, b) => rackOrder(a) - rackOrder(b)),
    ...goals.filter((g) => g.kind === "balance").sort((a, b) => b.priority - a.priority),
  ];

  return {
    day: today,
    dayType: resolved.dayType,
    overrides: resolved.overrides,
    raceBuild,
    goals: [...core, ...stretch].map(finalize),
    budgetMin: input.budgetMin,
    plannedMin,
    overBudget: plannedMin > input.budgetMin,
  };
}

function finalize({ nn, textOverride, notes, ...g }: Draft): PlannedGoal {
  return {
    ...g,
    text: textOverride ?? nn.text[g.tier],
    estMin: nn.minutes[g.tier],
    note: notes.length ? notes.join(" ") : null,
  };
}

/** Per scheduled day for one non-negotiable: was any goal for it done? Newest first. */
function scheduledDays(nonNegotiableId: string, history: GoalRecord[]): { day: DayKey; done: boolean; result: Tier | null }[] {
  const days = new Map<DayKey, { core: boolean; result: Tier | null }>();
  const rank = { floor: 1, standard: 2, stretch: 3 } as const;
  for (const h of history) {
    if (h.nonNegotiableId !== nonNegotiableId) continue;
    const d = days.get(h.day) ?? { core: false, result: null };
    if (h.kind !== "stretch") d.core = true;
    if (h.result && (!d.result || rank[h.result] > rank[d.result])) d.result = h.result;
    days.set(h.day, d);
  }
  return [...days.entries()]
    .filter(([, d]) => d.core)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, d]) => ({ day, done: d.result !== null, result: d.result }));
}

function missedLastTwo(nonNegotiableId: string, history: GoalRecord[]): boolean {
  const last = scheduledDays(nonNegotiableId, history).slice(0, 2);
  return last.length === 2 && last.every((d) => !d.done);
}

// ───────────────────────────── Adaptive difficulty (spec 7.4): suggestions only

export type DifficultySuggestion = {
  nonNegotiableId: string;
  kind: "level_up" | "ease";
  message: string;
};

const ADHERENCE_VALUE: Record<Tier, number> = { floor: 0.5, standard: 1, stretch: 1 };

/**
 * Standard or better on 7 of the last 7 scheduled days: suggest leveling up.
 * Under 60% over the last 14 days (with at least 4 scheduled days): suggest easing.
 * Never changes anything; the weekly review accepts or rejects.
 */
export function suggestDifficulty(nonNegotiableId: string, history: GoalRecord[], today: DayKey): DifficultySuggestion | null {
  const days = scheduledDays(
    nonNegotiableId,
    history.filter((h) => h.day < today),
  );

  const last7 = days.slice(0, 7);
  if (last7.length === 7 && last7.every((d) => d.result === "standard" || d.result === "stretch")) {
    return { nonNegotiableId, kind: "level_up", message: "You've crushed this. Level it up?" };
  }

  const recent = days.filter((d) => daysBetween(d.day, today) <= 14);
  if (recent.length >= 4) {
    const rate = recent.reduce((s, d) => s + (d.result ? ADHERENCE_VALUE[d.result] : 0), 0) / recent.length;
    if (rate < 0.6) {
      return {
        nonNegotiableId,
        kind: "ease",
        message: `${Math.round(rate * 100)}% over the last 14 days. Ease the default tier?`,
      };
    }
  }
  return null;
}
