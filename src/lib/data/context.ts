import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDay, type PlanInput, type ResolvedDay } from "@/engine/goalEngine";
import { scoreBreakdown, type SkillBreakdown } from "@/engine/scoring";
import { addDays, dayKey } from "@/engine/time";
import type { EngineSkill, GoalRecord } from "@/engine/types";
import type {
  CategoryRow,
  DayOverrideRow,
  KeyDateRow,
  MetricRow,
  MilestoneRow,
  NonNegotiableRow,
  PlanGoalRow,
  ProfileRow,
  RackPinRow,
  ScheduleDayRow,
  SkillRow,
} from "./rows";

/** Goal history pulled per load. Covers the 28-day consistency window and never-miss-twice lookbacks. */
export const HISTORY_DAYS = 90;

export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Loading ${what} failed: ${res.error.message}`);
  return res.data as T;
}

export const toRecord = (g: PlanGoalRow): GoalRecord => ({
  day: g.daily_plans.day,
  skillId: g.skill_id,
  nonNegotiableId: g.non_negotiable_id,
  kind: g.kind,
  plannedTier: g.tier,
  result: g.result_tier,
});

export async function loadGoals(supabase: SupabaseClient, since: string, until?: string): Promise<PlanGoalRow[]> {
  let q = supabase
    .from("plan_goals")
    .select(
      "id, skill_id, non_negotiable_id, kind, tier, title, text, est_min, reason, engine_note, sort, result_tier, user_note, daily_plans!inner(day)",
    )
    .gte("daily_plans.day", since);
  if (until) q = q.lte("daily_plans.day", until);
  return must(await q.order("sort"), "goals") as unknown as PlanGoalRow[];
}

export async function loadProfile(supabase: SupabaseClient): Promise<ProfileRow> {
  return must(
    await supabase.from("profiles").select("timezone, rollover_hour, daily_budget_min, focus_line, sound_on, onboarded_at, seen_figure_tier").single(),
    "profile",
  ) as ProfileRow;
}

export function todayFor(profile: ProfileRow, now: Date): string {
  return dayKey(now, profile.timezone, profile.rollover_hour);
}

export type UserContext = {
  profile: ProfileRow;
  now: Date;
  today: string;
  categories: CategoryRow[];
  skills: SkillRow[];
  milestones: MilestoneRow[];
  nonNegotiables: NonNegotiableRow[];
  rackPins: RackPinRow[];
  metrics: MetricRow[];
  resolved: ResolvedDay;
  goalRows: PlanGoalRow[];
  history: GoalRecord[];
  breakdowns: Map<string, SkillBreakdown>;
  engineSkills: EngineSkill[];
  planInput: () => PlanInput;
};

/** Loads the rows the engines need and scores every skill. Read-only. */
export async function loadUserContext(supabase: SupabaseClient, now: Date): Promise<UserContext> {
  const profile = await loadProfile(supabase);
  const today = todayFor(profile, now);

  const [cats, skillRows, milestoneRows, nnRows, pins, sched, overrides, races, goalRows, metricRows] = await Promise.all([
    supabase.from("categories").select("id, slug, name, color, icon, region, position, goal_weight, sort").order("sort"),
    supabase
      .from("skills")
      .select("id, slug, name, category_id, status, priority_weight, sort, created_at, final_score, identity, hundred_means, metrics_note, tips, config, archived_at, seen_tip_tier")
      .order("sort"),
    supabase.from("milestones").select("id, skill_id, title, points, type, rule, suggest_claim, sort, claimed_at, proof_url, proof_value").order("sort"),
    supabase
      .from("non_negotiables")
      .select(
        "id, skill_id, name, floor_text, standard_text, stretch_text, floor_min, standard_min, stretch_min, counts_against_budget, intention, days_of_week, day_types, default_tier, sort",
      )
      .eq("active", true)
      .order("sort"),
    supabase.from("rack_pins").select("slot, skill_id, locked_until, pinned_at").order("slot"),
    supabase.from("schedule_days").select("weekday, day_type, schedule_templates!inner(is_active)").eq("schedule_templates.is_active", true),
    supabase.from("day_overrides").select("kind, starts_on, ends_on").gte("ends_on", today),
    supabase.from("key_dates").select("label, date").eq("kind", "race").not("date", "is", null),
    loadGoals(supabase, addDays(today, -HISTORY_DAYS)),
    supabase.from("metrics").select("id, skill_id, key, value, day, recorded_at, source").order("day").order("recorded_at").limit(5000),
  ]);

  const categories = must(cats, "categories") as CategoryRow[];
  const skills = must(skillRows, "skills") as SkillRow[];
  const milestones = must(milestoneRows, "milestones") as MilestoneRow[];
  const nonNegotiables = must(nnRows, "non-negotiables") as NonNegotiableRow[];
  const rackPins = must(pins, "rack") as RackPinRow[];
  const schedule = must(sched, "schedule") as ScheduleDayRow[];
  const dayOverrides = must(overrides, "overrides") as DayOverrideRow[];
  const raceDates = must(races, "races") as KeyDateRow[];
  const metrics = (must(metricRows, "metrics") as MetricRow[]).map((m) => ({ ...m, value: Number(m.value) }));

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

  const engineSkills: EngineSkill[] = skills.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    categoryId: s.category_id,
    status: s.status,
    priorityWeight: s.priority_weight,
    score: breakdowns.get(s.id)!.score,
    nonNegotiables: nonNegotiables
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

  const resolved = resolveDay(
    today,
    schedule.map((d) => ({ weekday: d.weekday, dayType: d.day_type })),
    dayOverrides.map((o) => ({ kind: o.kind, startsOn: o.starts_on, endsOn: o.ends_on })),
    raceDates.flatMap((r) => (r.date ? [{ date: r.date, label: r.label }] : [])),
  );

  return {
    profile,
    now,
    today,
    categories,
    skills,
    milestones,
    nonNegotiables,
    rackPins,
    metrics,
    resolved,
    goalRows,
    history,
    breakdowns,
    engineSkills,
    planInput: () => ({
      resolved,
      now,
      budgetMin: profile.daily_budget_min,
      categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, goalWeight: Number(c.goal_weight) })),
      skills: engineSkills,
      rack: rackPins.map((p) => p.skill_id),
      history,
    }),
  };
}
