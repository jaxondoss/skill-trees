import "server-only";
import { connection } from "next/server";
import { computeStreak, dailyCompletion, STREAK_THRESHOLD } from "@/engine/completion";
import { generatePlan } from "@/engine/goalEngine";
import {
  buildSnapshots,
  categoryScore,
  displayScore,
  figureTier,
  isNeglected,
  overallScore,
  trend,
} from "@/engine/scoring";
import { addDays, dayKey } from "@/engine/time";
import type { Tier } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import { autoClaim } from "./claims";
import { HISTORY_DAYS, loadGoals, loadUserContext, must, type UserContext } from "./context";
import { syncDue } from "./integrations";
import { reviewPrompt } from "./reviews";
import type { CompletionRow, PlanGoalRow, SnapshotRow } from "./rows";

export type BottleShape = "faceted" | "round" | "vial" | "sturdy" | "teardrop";
export const SHAPE_BY_CATEGORY: Record<string, BottleShape> = {
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
  status: "active" | "dormant" | "archived";
  score: number;
  display: number;
  level: number;
  consistency: number;
  neglected: boolean;
  trendDelta: number | null;
  trendArrow: "up" | "down" | null;
  finalScore: number | null;
  pinned: boolean;
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
  categoryId: string;
  kind: PlanGoalRow["kind"];
  tier: Tier;
  title: string;
  text: string;
  estMin: number;
  reason: string | null;
  note: string | null;
  userNote: string | null;
  intention: string | null;
  tierTexts: Record<Tier, string> | null;
  resultTier: Tier | null;
  skillName: string;
  color: string;
};

export type DashboardData = {
  today: string;
  overall: { score: number; display: number; tier: number; tierNumeral: string; tierName: string; trendDelta: number | null };
  todayP: number | null;
  streak: { current: number; best: number; todayCounted: boolean };
  /** A break the user has not seen yet: show the crack, then "Streak ended at N. Best: M." */
  streakBreak: { length: number; best: number } | null;
  focusLine: string | null;
  soundOn: boolean;
  onboarded: boolean;
  /** Overall rose into a tier not yet celebrated: play the tier-up moment. */
  tierUp: { tier: number; numeral: string; name: string } | null;
  /** Milestones auto-claimed on this load. */
  claimed: string[];
  categories: CategoryView[];
  /** daysLocked: whole days left on the 7-day pin lock, 0 when unlocked. */
  rack: { slot: number; skill: SkillView | null; daysLocked: number }[];
  goals: GoalView[];
  skills: SkillView[];
  /** Day completion for the calendar: closed days plus today. */
  calendar: { day: string; p: number }[];
  plan: { overBudget: boolean; plannedMin: number; budgetMin: number; overrides: string[]; swapUsed: boolean };
  /** Sunday nudges until the review is saved (spec 4.4). */
  review: { weekly: boolean; monthly: boolean };
};

/**
 * Everything the dashboard shows, computed by the engines from the user's rows.
 * Side effects (all idempotent): creates today's plan if missing, records closed days'
 * completion, refreshes today's score snapshots, and caches streak state.
 */
export async function loadDashboard(at?: Date): Promise<DashboardData> {
  return (await loadDashboardContext(at)).data;
}

/** loadDashboard plus the user context it was computed from, for views that need more rows (the board). */
export async function loadDashboardContext(at?: Date): Promise<{ data: DashboardData; ctx: UserContext }> {
  // Request-time only: this reads the clock and writes today's plan, so it must never be prerendered.
  await connection();
  const supabase = await createClient();
  let ctx = await loadUserContext(supabase, at ?? new Date());
  // Connected integrations re-sync on open when their last sync is older than 6 hours.
  if (ctx.integrations.length) {
    const { data: who } = await supabase.auth.getClaims();
    const uid = typeof who?.claims?.sub === "string" ? who.claims.sub : null;
    if (uid && (await syncDue(supabase, uid, ctx.today, ctx.integrations, ctx.now))) ctx = await loadUserContext(supabase, ctx.now);
  }
  // Milestones whose rule is now met are claimed before scoring, so the numbers include them.
  const claimed = await autoClaim(supabase, ctx);
  if (claimed.length) ctx = await loadUserContext(supabase, ctx.now);
  const { profile, today, categories, skills, breakdowns, rackPins, now } = ctx;
  let goalRows = ctx.goalRows;

  // ── Today's plan: generated once, on first open of the day.
  if (!goalRows.some((g) => g.daily_plans.day === today)) {
    const saved = await supabase.rpc("save_plan", { p_day: today, p_plan: generatePlan(ctx.planInput()) });
    if (saved.error) throw new Error(`Saving today's plan failed: ${saved.error.message}`);
    goalRows = await loadGoals(supabase, addDays(today, -HISTORY_DAYS));
  }
  const todayRows = goalRows.filter((g) => g.daily_plans.day === today);

  const [planRes, completionRes, snapshotRes, streakRes, authRes, review] = await Promise.all([
    supabase.from("daily_plans").select("over_budget, planned_min, budget_min, overrides, swap_used").eq("day", today).maybeSingle(),
    supabase.from("daily_completions").select("day, p, n_core, kept_streak").order("day", { ascending: false }).limit(1000),
    supabase.from("score_snapshots").select("scope, ref_id, score").eq("day", addDays(today, -7)),
    supabase.from("streak_state").select("broken_on, broken_length").maybeSingle(),
    supabase.auth.getClaims(),
    reviewPrompt(supabase, today),
  ]);
  const planRow = planRes.data;
  const completionRows = must(completionRes, "completions") as CompletionRow[];
  const snapshots = must(snapshotRes, "snapshots") as SnapshotRow[];
  const userId = authRes.data?.claims?.sub;

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
  if (upserts.length && userId) {
    const res = await supabase.from("daily_completions").upsert(upserts.map((u) => ({ ...u, user_id: userId })));
    if (res.error) throw new Error(`Saving completions failed: ${res.error.message}`);
  }

  const todayP = dailyCompletion(todayRows.map((r) => ({ kind: r.kind, result: r.result_tier }))).p;
  const closedDays = [...known.values()].map((c) => ({ day: c.day, p: Number(c.p) }));
  const streak = computeStreak([...closedDays, { day: today, p: todayP }], today);

  // A break not yet shown: compare with the last break the user acknowledged.
  const seen = streakRes.data as { broken_on: string | null } | null;
  const streakBreak =
    streak.lastBreak && streak.lastBreak.on !== seen?.broken_on ? { length: streak.lastBreak.length, best: streak.best } : null;

  // ── Views.
  const catById = new Map(categories.map((c) => [c.id, c]));
  const weekAgoScore = (scope: SnapshotRow["scope"], id: string | null) => {
    const row = snapshots.find((r) => r.scope === scope && r.ref_id === id);
    return row ? Number(row.score) : null;
  };
  const lastDone = new Map<string, string>();
  for (const h of ctx.history) if (h.result && (lastDone.get(h.skillId) ?? "") < h.day) lastDone.set(h.skillId, h.day);
  const pinnedIds = new Set(rackPins.map((p) => p.skill_id));

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
        {
          status: s.status,
          lastDone: lastDone.get(s.id) ?? null,
          activeSince: dayKey(new Date(s.created_at), profile.timezone, profile.rollover_hour),
        },
        today,
      ),
      trendDelta: t.delta,
      trendArrow: t.arrow,
      finalScore: s.final_score === null ? null : Number(s.final_score),
      pinned: pinnedIds.has(s.id),
    };
  });
  const skillById = new Map(skillViews.map((s) => [s.id, s]));
  const weightOf = new Map(skills.map((s) => [s.id, s.priority_weight]));

  const categoryViews: CategoryView[] = categories.map((c) => {
    const members = skillViews.filter((s) => s.categoryId === c.id);
    const score = categoryScore(members.map((s) => ({ status: s.status, priorityWeight: weightOf.get(s.id)!, score: s.score })));
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
  // A drop is recorded quietly, so rising back into a tier celebrates it again.
  if (tier.tier < profile.seen_figure_tier && userId) {
    await supabase.from("profiles").update({ seen_figure_tier: tier.tier }).eq("user_id", userId);
  }
  const tierUp = tier.tier > profile.seen_figure_tier ? { tier: tier.tier, numeral: tier.numeral, name: tier.name } : null;

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
        priorityWeight: weightOf.get(s.id)!,
        breakdown: { score: s.score, level: s.level, consistency: s.consistency },
      })),
    ),
  });
  if (snap.error) throw new Error(`Saving snapshots failed: ${snap.error.message}`);

  const nnById = new Map(ctx.nonNegotiables.map((n) => [n.id, n]));
  const data: DashboardData = {
    today,
    overall: { score: overall, display: displayScore(overall), tier: tier.tier, tierNumeral: tier.numeral, tierName: tier.name, trendDelta: overallTrend.delta },
    todayP,
    streak: { current: streak.current, best: streak.best, todayCounted: streak.todayCounted },
    streakBreak,
    focusLine: profile.focus_line,
    soundOn: profile.sound_on,
    onboarded: profile.onboarded_at !== null,
    claimed,
    tierUp,
    categories: categoryViews,
    rack: [1, 2, 3, 4, 5].map((slot) => {
      const pin = rackPins.find((p) => p.slot === slot);
      const msLeft = pin ? new Date(pin.locked_until).getTime() - now.getTime() : 0;
      return { slot, skill: pin ? (skillById.get(pin.skill_id) ?? null) : null, daysLocked: Math.max(0, Math.ceil(msLeft / 86_400_000)) };
    }),
    goals: todayRows.map((g) => {
      const s = skillById.get(g.skill_id);
      const nn = g.non_negotiable_id ? nnById.get(g.non_negotiable_id) : undefined;
      return {
        id: g.id,
        skillId: g.skill_id,
        categoryId: s?.categoryId ?? "",
        kind: g.kind,
        tier: g.tier,
        title: g.title,
        text: g.text,
        estMin: g.est_min,
        reason: g.reason,
        note: g.engine_note,
        userNote: g.user_note,
        intention: nn?.intention ?? null,
        tierTexts: nn ? { floor: nn.floor_text, standard: nn.standard_text, stretch: nn.stretch_text } : null,
        resultTier: g.result_tier,
        skillName: s?.name ?? "",
        color: s?.color ?? "#8E8A84",
      };
    }),
    skills: skillViews,
    calendar: [...closedDays, ...(todayP === null ? [] : [{ day: today, p: todayP }])].sort((a, b) => (a.day < b.day ? -1 : 1)),
    plan: {
      overBudget: planRow?.over_budget ?? false,
      plannedMin: planRow?.planned_min ?? 0,
      budgetMin: planRow?.budget_min ?? profile.daily_budget_min,
      overrides: planRow?.overrides ?? [],
      swapUsed: planRow?.swap_used ?? false,
    },
    review,
  };
  return { data, ctx };
}
