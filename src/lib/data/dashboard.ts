import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { computeStreak, dailyCompletion, STREAK_THRESHOLD } from "@/engine/completion";
import { generatePlan, resolveDay, type Plan } from "@/engine/goalEngine";
import {
  buildSnapshots,
  categoryScore,
  displayScore,
  figureTier,
  isNeglected,
  overallScore,
  scoreBreakdown,
  trend,
  type SkillBreakdown,
} from "@/engine/scoring";
import { addDays, dayKey } from "@/engine/time";
import type { EngineSkill, GoalRecord, Tier } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import type {
  CategoryRow,
  CompletionRow,
  DayOverrideRow,
  KeyDateRow,
  MilestoneRow,
  NonNegotiableRow,
  PlanGoalRow,
  ProfileRow,
  RackPinRow,
  ScheduleDayRow,
  SkillRow,
  SnapshotRow,
} from "./rows";

/** Goal history pulled per load. Covers the 28-day consistency window and never-miss-twice lookbacks. */
const HISTORY_DAYS = 90;

export type BottleShape = "faceted" | "round" | "vial" | "sturdy" | "teardrop";
const SHAPE_BY_CATEGORY: Record<string, BottleShape> = {
  business: "faceted",
  school: "round",
  mind: "vial",
  athletics: "sturdy",
  nutrition: "teardrop",
};

export type SkillView = {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  color: string;
  shape: BottleShape;
  status: SkillRow["status"];
  score: number;
  display: number;
  level: number;
  consistency: number;
  neglected: boolean;
  trendDelta: number | null;
  trendArrow: "up" | "down" | null;
  finalScore: number | null;
};

export type CategoryView = {
  id: string;
  slug: string;
  name: string;
  color: string;
  icon: string | null;
  region: string;
  position: string;
  score: number | null;
  display: number | null;
  lowest: { name: string; display: number } | null;
  dots: boolean[];
};

export type GoalView = {
  id: string;
  skillId: string;
  kind: PlanGoalRow["kind"];
  tier: Tier;
  title: string;
  text: string;
  estMin: number;
  reason: string | null;
  note: string | null;
  resultTier: Tier | null;
  skillName: string;
  color: string;
};

export type DashboardData = {
  today: string;
  overall: { score: number; display: number; tierNumeral: string; tierName: string; trendDelta: number | null };
  todayP: number | null;
  streak: { current: number; best: number; todayCounted: boolean };
  focusLine: string | null;
  categories: CategoryView[];
  /** daysLocked: whole days left on the 7-day pin lock, 0 when unlocked. */
  rack: { slot: number; skill: SkillView | null; daysLocked: number }[];
  goals: GoalView[];
  skills: SkillView[];
  plan: { overBudget: boolean; plannedMin: number; budgetMin: number; overrides: string[] };
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Loading ${what} failed: ${res.error.message}`);
  return res.data as T;
}

const toRecord = (g: PlanGoalRow): GoalRecord => ({
  day: g.daily_plans.day,
  skillId: g.skill_id,
  nonNegotiableId: g.non_negotiable_id,
  kind: g.kind,
  plannedTier: g.tier,
  result: g.result_tier,
});

async function loadGoals(supabase: SupabaseClient, since: string): Promise<PlanGoalRow[]> {
  return must(
    await supabase
      .from("plan_goals")
      .select(
        "id, skill_id, non_negotiable_id, kind, tier, title, text, est_min, reason, engine_note, sort, result_tier, daily_plans!inner(day)",
      )
      .gte("daily_plans.day", since)
      .order("sort"),
    "goals",
  ) as unknown as PlanGoalRow[];
}

/**
 * Everything the dashboard shows, computed by the engines from the user's rows.
 * Side effects (all idempotent): creates today's plan if missing, records closed days'
 * completion, and refreshes today's score snapshots.
 */
export async function loadDashboard(at?: Date): Promise<DashboardData> {
  // Request-time only: this reads the clock and writes today's plan, so it must never be prerendered.
  await connection();
  const supabase = await createClient();
  const now = at ?? new Date();

  const profile = must(
    await supabase.from("profiles").select("timezone, rollover_hour, daily_budget_min, focus_line").single(),
    "profile",
  ) as ProfileRow;
  const today = dayKey(now, profile.timezone, profile.rollover_hour);
  const since = addDays(today, -HISTORY_DAYS);

  const [cats, skillRows, milestoneRows, nnRows, pins, sched, overrides, races, completions, weekAgo, goalRowsInitial] =
    await Promise.all([
      supabase.from("categories").select("id, slug, name, color, icon, region, position, goal_weight, sort").order("sort"),
      supabase.from("skills").select("id, slug, name, category_id, status, priority_weight, sort, created_at, final_score").order("sort"),
      supabase.from("milestones").select("skill_id, points, claimed_at"),
      supabase
        .from("non_negotiables")
        .select(
          "id, skill_id, name, floor_text, standard_text, stretch_text, floor_min, standard_min, stretch_min, counts_against_budget, intention, days_of_week, day_types, default_tier, sort",
        )
        .eq("active", true)
        .order("sort"),
      supabase.from("rack_pins").select("slot, skill_id, locked_until").order("slot"),
      supabase.from("schedule_days").select("weekday, day_type, schedule_templates!inner(is_active)").eq("schedule_templates.is_active", true),
      supabase.from("day_overrides").select("kind, starts_on, ends_on").gte("ends_on", today),
      supabase.from("key_dates").select("label, date").eq("kind", "race").not("date", "is", null),
      supabase.from("daily_completions").select("day, p, n_core, kept_streak").order("day", { ascending: false }).limit(1000),
      supabase.from("score_snapshots").select("scope, ref_id, score").eq("day", addDays(today, -7)),
      loadGoals(supabase, since),
    ]);

  const categories = must(cats, "categories") as CategoryRow[];
  const skills = must(skillRows, "skills") as SkillRow[];
  const milestones = must(milestoneRows, "milestones") as MilestoneRow[];
  const nns = must(nnRows, "non-negotiables") as NonNegotiableRow[];
  const rackPins = must(pins, "rack") as RackPinRow[];
  const schedule = must(sched, "schedule") as ScheduleDayRow[];
  const dayOverrides = must(overrides, "overrides") as DayOverrideRow[];
  const raceDates = must(races, "races") as KeyDateRow[];
  const completionRows = must(completions, "completions") as CompletionRow[];
  const snapshots = must(weekAgo, "snapshots") as SnapshotRow[];
  let goalRows = goalRowsInitial;

  const catById = new Map(categories.map((c) => [c.id, c]));

  // ── Scores, from claimed milestones and goal history.
  const history = goalRows.map(toRecord);
  const breakdowns = new Map<string, SkillBreakdown>();
  for (const s of skills) {
    breakdowns.set(
      s.id,
      scoreBreakdown(
        milestones.filter((m) => m.skill_id === s.id).map((m) => ({ points: m.points, claimed: m.claimed_at !== null })),
        history.filter((h) => h.skillId === s.id),
        today,
      ),
    );
  }

  // ── Today's plan: generated once, on first open of the day.
  if (!goalRows.some((g) => g.daily_plans.day === today)) {
    const engineSkills: EngineSkill[] = skills.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      categoryId: s.category_id,
      status: s.status,
      priorityWeight: s.priority_weight,
      score: breakdowns.get(s.id)!.score,
      nonNegotiables: nns
        .filter((n) => n.skill_id === s.id)
        .map((n) => ({
          id: n.id,
          skillId: n.skill_id,
          name: n.name,
          text: { floor: n.floor_text, standard: n.standard_text, stretch: n.stretch_text },
          minutes: { floor: n.floor_min, standard: n.standard_min, stretch: n.stretch_min },
          countsAgainstBudget: n.counts_against_budget,
          intention: n.intention,
          daysOfWeek: n.days_of_week,
          dayTypes: n.day_types,
          defaultTier: n.default_tier,
        })),
    }));
    const plan: Plan = generatePlan({
      resolved: resolveDay(
        today,
        schedule.map((d) => ({ weekday: d.weekday, dayType: d.day_type })),
        dayOverrides.map((o) => ({ kind: o.kind, startsOn: o.starts_on, endsOn: o.ends_on })),
        raceDates.flatMap((r) => (r.date ? [{ date: r.date, label: r.label }] : [])),
      ),
      now,
      budgetMin: profile.daily_budget_min,
      categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, goalWeight: Number(c.goal_weight) })),
      skills: engineSkills,
      rack: rackPins.map((p) => p.skill_id),
      history,
    });
    const saved = await supabase.rpc("save_plan", { p_day: today, p_plan: plan });
    if (saved.error) throw new Error(`Saving today's plan failed: ${saved.error.message}`);
    goalRows = await loadGoals(supabase, since);
  }

  const todayRows = goalRows.filter((g) => g.daily_plans.day === today);
  const { data: planRow } = await supabase
    .from("daily_plans")
    .select("over_budget, planned_min, budget_min, overrides")
    .eq("day", today)
    .maybeSingle();

  // ── Completion per day, cached for closed days so streaks reach past the history window.
  const byDay = new Map<string, PlanGoalRow[]>();
  for (const g of goalRows) byDay.set(g.daily_plans.day, [...(byDay.get(g.daily_plans.day) ?? []), g]);
  const known = new Map(completionRows.map((c) => [c.day, c]));
  const upserts: CompletionRow[] = [];
  for (const [day, rows] of byDay) {
    if (day >= today) continue;
    const { p, nCore } = dailyCompletion(rows.map((r) => ({ kind: r.kind, result: r.result_tier })));
    if (p === null) continue;
    const rounded = Math.round(p * 100) / 100;
    const prev = known.get(day);
    if (!prev || Number(prev.p) !== rounded) {
      const row = { day, p: rounded, n_core: nCore, kept_streak: rounded >= STREAK_THRESHOLD };
      upserts.push(row);
      known.set(day, row);
    }
  }
  if (upserts.length) {
    const { data: auth } = await supabase.auth.getClaims();
    const userId = auth?.claims?.sub;
    if (userId) {
      const res = await supabase.from("daily_completions").upsert(upserts.map((u) => ({ ...u, user_id: userId })));
      if (res.error) throw new Error(`Saving completions failed: ${res.error.message}`);
    }
  }

  const todayP = dailyCompletion(todayRows.map((r) => ({ kind: r.kind, result: r.result_tier }))).p;
  const streak = computeStreak(
    [...[...known.values()].map((c) => ({ day: c.day, p: Number(c.p) })), { day: today, p: todayP }],
    today,
  );

  // ── Category and overall scores.
  const weekAgoScore = (scope: SnapshotRow["scope"], id: string | null) => {
    const row = snapshots.find((r) => r.scope === scope && r.ref_id === id);
    return row ? Number(row.score) : null;
  };
  const lastDone = new Map<string, string>();
  for (const h of history) if (h.result && (lastDone.get(h.skillId) ?? "") < h.day) lastDone.set(h.skillId, h.day);

  const skillViews: SkillView[] = skills.map((s) => {
    const b = breakdowns.get(s.id)!;
    const cat = catById.get(s.category_id);
    const t = trend(b.score, weekAgoScore("skill", s.id));
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      categoryId: s.category_id,
      color: cat?.color ?? "#8E8A84",
      shape: SHAPE_BY_CATEGORY[cat?.slug ?? ""] ?? "round",
      status: s.status,
      score: b.score,
      display: displayScore(b.score),
      level: b.level,
      consistency: b.consistency,
      neglected: isNeglected(
        { status: s.status, lastDone: lastDone.get(s.id) ?? null, activeSince: dayKey(new Date(s.created_at), profile.timezone, profile.rollover_hour) },
        today,
      ),
      trendDelta: t.delta,
      trendArrow: t.arrow,
      finalScore: s.final_score === null ? null : Number(s.final_score),
    };
  });

  const categoryViews: CategoryView[] = categories.map((c) => {
    const members = skillViews.filter((s) => s.categoryId === c.id);
    const score = categoryScore(
      members.map((s) => ({ status: s.status, priorityWeight: skills.find((r) => r.id === s.id)!.priority_weight, score: s.score })),
    );
    const lowest = members.filter((s) => s.status === "active").sort((a, b) => a.score - b.score)[0];
    const memberIds = new Set(members.map((s) => s.id));
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      color: c.color,
      icon: c.icon,
      region: c.region,
      position: c.position,
      score,
      display: score === null ? null : displayScore(score),
      lowest: lowest ? { name: lowest.name, display: lowest.display } : null,
      dots: todayRows.filter((g) => g.kind !== "stretch" && memberIds.has(g.skill_id)).map((g) => g.result_tier !== null),
    };
  });

  const overall = overallScore(categoryViews.map((c) => c.score));
  const tier = figureTier(overall);
  const overallTrend = trend(overall, weekAgoScore("overall", null));

  // ── Today's snapshot, overwritten through the day so the last write is the closing value.
  const snap = await supabase.rpc("save_snapshots", {
    p_day: today,
    p_rows: buildSnapshots(
      today,
      categories.map((c) => c.id),
      skillViews.map((s) => ({
        id: s.id,
        categoryId: s.categoryId,
        status: s.status,
        priorityWeight: skills.find((r) => r.id === s.id)!.priority_weight,
        breakdown: { score: s.score, level: s.level, consistency: s.consistency },
      })),
    ),
  });
  if (snap.error) throw new Error(`Saving snapshots failed: ${snap.error.message}`);

  const skillById = new Map(skillViews.map((s) => [s.id, s]));
  return {
    today,
    overall: {
      score: overall,
      display: displayScore(overall),
      tierNumeral: tier.numeral,
      tierName: tier.name,
      trendDelta: overallTrend.delta,
    },
    todayP,
    streak: { current: streak.current, best: streak.best, todayCounted: streak.todayCounted },
    focusLine: profile.focus_line,
    categories: categoryViews,
    rack: [1, 2, 3, 4, 5].map((slot) => {
      const pin = rackPins.find((p) => p.slot === slot);
      const msLeft = pin ? new Date(pin.locked_until).getTime() - now.getTime() : 0;
      return { slot, skill: pin ? (skillById.get(pin.skill_id) ?? null) : null, daysLocked: Math.max(0, Math.ceil(msLeft / 86_400_000)) };
    }),
    goals: todayRows.map((g) => {
      const s = skillById.get(g.skill_id);
      return {
        id: g.id,
        skillId: g.skill_id,
        kind: g.kind,
        tier: g.tier,
        title: g.title,
        text: g.text,
        estMin: g.est_min,
        reason: g.reason,
        note: g.engine_note,
        resultTier: g.result_tier,
        skillName: s?.name ?? "",
        color: s?.color ?? "#8E8A84",
      };
    }),
    skills: skillViews,
    plan: {
      overBudget: planRow?.over_budget ?? false,
      plannedMin: planRow?.planned_min ?? 0,
      budgetMin: planRow?.budget_min ?? profile.daily_budget_min,
      overrides: planRow?.overrides ?? [],
    },
  };
}
