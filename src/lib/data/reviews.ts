import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { computeStreak, dailyCompletion, winningWeeks } from "@/engine/completion";
import { suggestDifficulty } from "@/engine/goalEngine";
import { applyDifficulty, calibrationDrift, isFirstSunday, isSunday, monthStart, mostMissed, movers, previousMonthEnd, weekCompletion, type Calibration, type DifficultyKind } from "@/engine/review";
import { categoryScore, displayScore, figureTier, overallScore } from "@/engine/scoring";
import { addDays, weekStart } from "@/engine/time";
import type { Tier } from "@/engine/types";
import { aiAvailable } from "@/lib/ai";
import type { WeeklyFacts } from "@/lib/claude-prompts";
import { createClient } from "@/lib/supabase/server";
import { loadProfile, loadUserContext, must, todayFor, type UserContext } from "./context";

export const DROPSHIP_KEYS = ["revenue_week_usd", "ad_spend_week_usd", "orders_week"] as const;
export type DropshipKey = (typeof DROPSHIP_KEYS)[number];

export type Decision = { nonNegotiableId: string; kind: DifficultyKind; accepted: boolean };

type SnapRow = { day: string; scope: "skill" | "category" | "overall"; ref_id: string | null; score: number };

/** Latest snapshot per scope and ref on or before a day (the closing value of that day or earlier). */
async function snapshotsAsOf(supabase: SupabaseClient, day: string, since: string): Promise<Map<string, number>> {
  const rows = must(
    await supabase.from("score_snapshots").select("day, scope, ref_id, score").lte("day", day).gte("day", since).order("day", { ascending: false }).limit(2000),
    "snapshots",
  ) as SnapRow[];
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.scope === "overall" ? "overall" : r.ref_id!;
    if (!out.has(key)) out.set(key, Number(r.score));
  }
  return out;
}

/** Current category and overall scores from the context's skill breakdowns (same math as the dashboard). */
export function currentScores(ctx: UserContext) {
  const categories = ctx.categories.map((c) => {
    const members = ctx.skills.filter((s) => s.category_id === c.id);
    const score = categoryScore(members.map((s) => ({ status: s.status, priorityWeight: s.priority_weight, score: ctx.breakdowns.get(s.id)!.score })));
    return { id: c.id, name: c.name, color: c.color, region: c.region, score };
  });
  const overall = overallScore(categories.map((c) => c.score));
  return { categories, overall };
}

async function completionDays(supabase: SupabaseClient, ctx: UserContext) {
  const rows = must(await supabase.from("daily_completions").select("day, p").order("day").limit(2000), "completions") as { day: string; p: number }[];
  const closed = rows.filter((r) => r.day < ctx.today).map((r) => ({ day: r.day, p: Number(r.p) }));
  const todayP = dailyCompletion(ctx.goalRows.filter((g) => g.daily_plans.day === ctx.today).map((g) => ({ kind: g.kind, result: g.result_tier }))).p;
  return [...closed, { day: ctx.today, p: todayP }];
}

export type WeeklyReviewData = Awaited<ReturnType<typeof buildWeek>>;

/** Everything the weekly review needs, plus the facts the debrief is written from. */
export async function buildWeek(supabase: SupabaseClient, ctx: UserContext) {
  const ws = weekStart(ctx.today);
  const sunday = addDays(ws, 6);
  const allDays = await completionDays(supabase, ctx);
  const week = allDays.filter((d) => d.day >= ws && d.day <= sunday);
  const completion = weekCompletion(week);
  const streak = computeStreak(allDays, ctx.today);
  const winning = winningWeeks(allDays).filter((w) => w.winning).length;

  const before = await snapshotsAsOf(supabase, addDays(ws, -1), addDays(ws, -14));
  const now = currentScores(ctx);
  const skillNow = new Map(ctx.skills.filter((s) => s.status === "active").map((s) => [s.id, ctx.breakdowns.get(s.id)!.score]));
  const move = movers(skillNow, before);
  const name = (id: string) => ctx.skills.find((s) => s.id === id)?.name ?? "";
  const colorOf = (id: string) => {
    const s = ctx.skills.find((k) => k.id === id);
    return ctx.categories.find((c) => c.id === s?.category_id)?.color ?? "#8E8A84";
  };

  const { data: existingRow } = await supabase.from("weekly_reviews").select("obstacle, focus_line, decisions, debrief").eq("week_start", ws).maybeSingle();
  const existing = existingRow as { obstacle: string | null; focus_line: string | null; decisions: Decision[]; debrief: string | null } | null;

  const activeSkills = new Set(ctx.skills.filter((s) => s.status === "active").map((s) => s.id));
  const suggestions = ctx.nonNegotiables
    .filter((n) => activeSkills.has(n.skill_id))
    .flatMap((n) => {
      const s = suggestDifficulty(n.id, ctx.history, ctx.today);
      const decided = existing?.decisions.find((d) => d.nonNegotiableId === n.id);
      if (!s && !decided) return [];
      const kind = (decided?.kind ?? s!.kind) as DifficultyKind;
      const tier = n.default_tier as Tier;
      return [
        {
          nonNegotiableId: n.id,
          kind,
          skillName: name(n.skill_id),
          name: n.name,
          message: s?.message ?? (kind === "level_up" ? "Level it up?" : "Ease the default tier?"),
          currentTier: tier,
          nextTier: decided?.accepted ? tier : applyDifficulty(tier, kind),
          decided: decided ? decided.accepted : null,
        },
      ];
    });

  const dropship = ctx.skills.find((s) => s.slug === "dropshipping" && s.status !== "archived");
  const weekMetric = (key: DropshipKey) => ctx.metrics.filter((m) => m.key === key && m.day === sunday).at(-1)?.value ?? null;

  const missed = mostMissed(ctx.history, ws, ctx.today).map((m) => ({ ...m, name: name(m.skillId) }));
  const facts: WeeklyFacts = {
    weekStart: ws,
    completionPct: completion.avg,
    keptDays: completion.kept,
    streak: streak.current,
    best: streak.best,
    overall: { now: now.overall, weekAgo: before.get("overall") ?? null, tier: figureTier(now.overall).name },
    riser: move.riser ? { name: name(move.riser.id), delta: move.riser.delta } : null,
    slipper: move.slipper ? { name: name(move.slipper.id), delta: move.slipper.delta } : null,
    missedMost: missed.map((m) => ({ name: m.name, missed: m.missed, scheduled: m.scheduled })),
    obstacle: existing?.obstacle ?? "",
    focusLine: existing?.focus_line ?? ctx.profile.focus_line ?? "",
  };

  return {
    today: ctx.today,
    weekStart: ws,
    sunday,
    isSunday: isSunday(ctx.today),
    days: Array.from({ length: 7 }, (_, i) => {
      const day = addDays(ws, i);
      return { day, p: week.find((d) => d.day === day)?.p ?? null, future: day > ctx.today };
    }),
    completion,
    winningWeek: completion.kept >= 5,
    winningWeeks: winning,
    streak: { current: streak.current, best: streak.best },
    overall: { display: displayScore(now.overall), delta: before.has("overall") ? now.overall - before.get("overall")! : null },
    riser: move.riser ? { name: name(move.riser.id), delta: move.riser.delta, color: colorOf(move.riser.id) } : null,
    slipper: move.slipper ? { name: name(move.slipper.id), delta: move.slipper.delta, color: colorOf(move.slipper.id) } : null,
    missed,
    suggestions,
    dropship: dropship ? Object.fromEntries(DROPSHIP_KEYS.map((k) => [k, weekMetric(k)])) as Record<DropshipKey, number | null> : null,
    saved: existing !== null,
    obstacle: existing?.obstacle ?? "",
    focusLine: existing?.focus_line ?? ctx.profile.focus_line ?? "",
    debrief: existing?.debrief ?? null,
    claude: aiAvailable(),
    facts,
  };
}

export async function loadWeeklyReview() {
  await connection();
  const supabase = await createClient();
  const week = await buildWeek(supabase, await loadUserContext(supabase, new Date()));
  // The debrief facts stay on the server.
  return { ...week, facts: undefined };
}

export async function loadMonthlyReview() {
  await connection();
  const supabase = await createClient();
  const ctx = await loadUserContext(supabase, new Date());
  const month = monthStart(ctx.today);
  const lastEnd = previousMonthEnd(ctx.today);
  const before = await snapshotsAsOf(supabase, lastEnd, addDays(lastEnd, -45));
  const now = currentScores(ctx);

  const [{ data: rows }] = await Promise.all([supabase.from("monthly_reviews").select("month, calibrations, notes").order("month").limit(24)]);
  const reviews = (rows ?? []) as { month: string; calibrations: Record<string, Calibration>; notes: string | null }[];
  const current = reviews.find((r) => r.month === month) ?? null;
  const drift = calibrationDrift(reviews.filter((r) => r.month < month).map((r) => r.calibrations));

  const points = (skillId: string) => ctx.milestones.filter((m) => m.skill_id === skillId).reduce((s, m) => s + m.points, 0);
  const catById = new Map(ctx.categories.map((c) => [c.id, c]));
  const skills = ctx.skills
    .filter((s) => s.status !== "archived")
    .sort((a, b) => (catById.get(a.category_id)?.sort ?? 0) - (catById.get(b.category_id)?.sort ?? 0) || a.sort - b.sort)
    .map((s) => {
      const score = ctx.breakdowns.get(s.id)!.score;
      const prev = before.get(s.id);
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        status: s.status,
        color: catById.get(s.category_id)?.color ?? "#8E8A84",
        display: displayScore(score),
        delta: prev === undefined ? null : score - prev,
        points: points(s.id),
        calibration: current?.calibrations[s.id] ?? null,
        drift: drift.get(s.id) ?? null,
      };
    });

  const figure = (scores: Map<string, number> | null) => {
    const cats = now.categories.map((c) => ({ region: c.region, score: scores ? (scores.get(c.id) ?? 0) : (c.score ?? 0) }));
    const overall = scores ? (scores.get("overall") ?? null) : now.overall;
    return { scores: Object.fromEntries(cats.map((c) => [c.region, c.score])), tier: overall === null ? null : figureTier(overall).tier, display: overall === null ? null : displayScore(overall) };
  };

  return {
    today: ctx.today,
    month,
    monthLabel: new Date(`${month}T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    isFirstSunday: isFirstSunday(ctx.today),
    now: figure(null),
    lastMonth: before.has("overall") ? figure(before) : null,
    skills,
    categories: ctx.categories.map((c) => ({ id: c.id, name: c.name })),
    notes: current?.notes ?? "",
    saved: current !== null,
  };
}

/** Dashboard nudge: on Sunday, until this week's review is saved; monthly on the first Sunday. */
export async function reviewPrompt(supabase: SupabaseClient, today: string): Promise<{ weekly: boolean; monthly: boolean }> {
  if (!isSunday(today)) return { weekly: false, monthly: false };
  const [w, m] = await Promise.all([
    supabase.from("weekly_reviews").select("id").eq("week_start", weekStart(today)).maybeSingle(),
    isFirstSunday(today) ? supabase.from("monthly_reviews").select("id").eq("month", monthStart(today)).maybeSingle() : Promise.resolve({ data: { id: "skip" } }),
  ]);
  return { weekly: !w.data, monthly: !m.data };
}

export async function monthStartFor(supabase: SupabaseClient): Promise<string> {
  return monthStart(todayFor(await loadProfile(supabase), new Date()));
}
