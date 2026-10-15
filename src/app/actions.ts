"use server";

import { refresh } from "next/cache";
import { computeStreak } from "@/engine/completion";
import { scheduledToday, swapCandidate } from "@/engine/goalEngine";
import type { Tier } from "@/engine/types";
import { loadGoals, loadProfile, loadUserContext, todayFor } from "@/lib/data/context";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const TIERS: Tier[] = ["floor", "standard", "stretch"];
const LOCK_DAYS = 7;
const NOTE_MAX = 200;

const fail = (error: string): ActionResult => ({ ok: false, error });

async function userId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}

/** Loads a goal and confirms it belongs to today's plan. Past days are read-only. */
async function todaysGoal(supabase: Awaited<ReturnType<typeof createClient>>, goalId: string) {
  const profile = await loadProfile(supabase);
  const today = todayFor(profile, new Date());
  const { data } = await supabase
    .from("plan_goals")
    .select("id, skill_id, kind, result_tier, daily_plans!inner(day)")
    .eq("id", goalId)
    .maybeSingle();
  const goal = data as { id: string; skill_id: string; kind: string; result_tier: Tier | null; daily_plans: { day: string } } | null;
  if (!goal || goal.daily_plans.day !== today) return null;
  return { goal, today };
}

/** Tap (or long-press choice): log a goal at a tier. Null tier undoes it. */
export async function completeGoal(goalId: string, tier: Tier | null, note?: string | null): Promise<ActionResult> {
  if (tier !== null && !TIERS.includes(tier)) return fail("Unknown tier.");
  const supabase = await createClient();
  const found = await todaysGoal(supabase, goalId);
  if (!found) return fail("Only today's goals can be logged.");

  const patch: Record<string, unknown> = {
    result_tier: tier,
    completed_at: tier ? new Date().toISOString() : null,
  };
  if (note !== undefined) patch.user_note = note?.trim().slice(0, NOTE_MAX) || null;

  const { error } = await supabase.from("plan_goals").update(patch).eq("id", goalId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const REPLAY_WINDOW_MS = 36 * 3_600_000;

/**
 * Replays a goal log made offline. It lands on the plan for the day it was tapped (so a log
 * from 11 PM still counts for that day after the 4 AM rollover), within a 36-hour window.
 */
export async function replayGoal(goalId: string, tier: Tier | null, note: string | null | undefined, at: string): Promise<ActionResult> {
  if (tier !== null && !TIERS.includes(tier)) return fail("Unknown tier.");
  const tapped = new Date(at);
  const now = Date.now();
  if (Number.isNaN(tapped.getTime()) || tapped.getTime() > now + 5 * 60_000 || now - tapped.getTime() > REPLAY_WINDOW_MS) {
    return fail("That offline log is too old to sync.");
  }
  const supabase = await createClient();
  const profile = await loadProfile(supabase);
  const { data } = await supabase.from("plan_goals").select("id, daily_plans!inner(day)").eq("id", goalId).maybeSingle();
  const goal = data as { id: string; daily_plans: { day: string } } | null;
  if (!goal || goal.daily_plans.day !== todayFor(profile, tapped)) return fail("That offline log no longer matches a plan.");

  const patch: Record<string, unknown> = { result_tier: tier, completed_at: tier ? tapped.toISOString() : null };
  if (note !== undefined) patch.user_note = note?.trim().slice(0, NOTE_MAX) || null;
  const { error } = await supabase.from("plan_goals").update(patch).eq("id", goalId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Long-press: a one-line note without changing the result. */
export async function saveNote(goalId: string, note: string): Promise<ActionResult> {
  const supabase = await createClient();
  if (!(await todaysGoal(supabase, goalId))) return fail("Only today's goals can be edited.");
  const { error } = await supabase
    .from("plan_goals")
    .update({ user_note: note.trim().slice(0, NOTE_MAX) || null })
    .eq("id", goalId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Swipe left: swap an open goal for the next-best option. Once per day. */
export async function swapGoal(goalId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const ctx = await loadUserContext(supabase, new Date());
  const todayRows = ctx.goalRows.filter((g) => g.daily_plans.day === ctx.today);
  const goal = todayRows.find((g) => g.id === goalId);
  if (!goal) return fail("Only today's goals can be swapped.");
  if (goal.kind === "stretch" || goal.result_tier) return fail("Only open core goals can be swapped.");

  const nnById = new Map(ctx.nonNegotiables.map((n) => [n.id, n]));
  const current = todayRows
    .filter((g) => g.kind !== "stretch")
    .map((g) => ({
      skillId: g.skill_id,
      estMin: g.est_min,
      countsAgainstBudget: g.non_negotiable_id ? (nnById.get(g.non_negotiable_id)?.counts_against_budget ?? true) : true,
    }));
  const next = swapCandidate(ctx.planInput(), current, goal.skill_id);
  if (!next) return fail("Nothing else is scheduled today.");

  const { error } = await supabase.rpc("swap_goal", { p_day: ctx.today, p_goal_id: goalId, p_new: next });
  if (error) return fail(error.hint === "swap_used" ? "You already used today's swap." : error.message);
  refresh();
  return { ok: true };
}

/** Pin a skill to a rack slot. Locked for 7 days. If it is scheduled today, it joins today's plan. */
export async function pinSkill(slot: number, skillId: string): Promise<ActionResult> {
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) return fail("Unknown slot.");
  const supabase = await createClient();
  const uid = await userId(supabase);
  if (!uid) return fail("Sign in again.");
  const ctx = await loadUserContext(supabase, new Date());

  const skill = ctx.engineSkills.find((s) => s.id === skillId);
  if (!skill || skill.status !== "active") return fail("Only active skills can be pinned.");
  if (ctx.rackPins.some((p) => p.skill_id === skillId)) return fail(`${skill.name} is already on the rack.`);

  const existing = ctx.rackPins.find((p) => p.slot === slot);
  if (existing) {
    if (new Date(existing.locked_until) > ctx.now) return fail("That slot is still locked.");
    const del = await supabase.from("rack_pins").delete().eq("slot", slot);
    if (del.error) return fail(del.error.message);
  }

  const lockedUntil = new Date(ctx.now.getTime() + LOCK_DAYS * 86_400_000).toISOString();
  const ins = await supabase.from("rack_pins").insert({ user_id: uid, slot, skill_id: skillId, locked_until: lockedUntil });
  if (ins.error) return fail(ins.error.message);

  // Join today's plan if the skill is scheduled today and not already in it.
  const todayRows = ctx.goalRows.filter((g) => g.daily_plans.day === ctx.today);
  const nn = scheduledToday(ctx.planInput(), skill);
  const { data: plan } = await supabase.from("daily_plans").select("id").eq("day", ctx.today).maybeSingle();
  if (plan && nn && !todayRows.some((g) => g.skill_id === skillId)) {
    await supabase.from("plan_goals").insert({
      user_id: uid,
      plan_id: (plan as { id: string }).id,
      skill_id: skillId,
      non_negotiable_id: nn.id,
      kind: "rack",
      tier: nn.defaultTier,
      title: nn.name,
      text: nn.text[nn.defaultTier],
      est_min: nn.minutes[nn.defaultTier],
      reason: "Rack (pinned today)",
      sort: todayRows.length,
    });
  }
  refresh();
  return { ok: true };
}

/** Pin into the first empty slot. Never replaces another pin. */
export async function pinToFreeSlot(skillId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.from("rack_pins").select("slot");
  const taken = new Set(((data ?? []) as { slot: number }[]).map((p) => p.slot));
  const slot = [1, 2, 3, 4, 5].find((s) => !taken.has(s));
  if (!slot) return fail("The rack is full. Remove a pin from the dashboard first.");
  return pinSkill(slot, skillId);
}

/** Remove a pin once its lock has expired. The database refuses while locked. */
export async function unpinSkill(slot: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("rack_pins").delete().eq("slot", slot);
  if (error) return fail(error.hint === "rack_locked" ? "Still locked. Pins hold for 7 days." : error.message);
  refresh();
  return { ok: true };
}

/** The tier-up moment played: remember the tier so it plays once. */
export async function ackTierUp(tier: number): Promise<ActionResult> {
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) return fail("Unknown tier.");
  const supabase = await createClient();
  const uid = await userId(supabase);
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase.from("profiles").update({ seen_figure_tier: tier }).eq("user_id", uid);
  if (error) return fail(error.message);
  return { ok: true };
}

/** Marks the latest streak break as seen, after the crack animation plays. */
export async function ackStreakBreak(): Promise<ActionResult> {
  const supabase = await createClient();
  const profile = await loadProfile(supabase);
  const today = todayFor(profile, new Date());
  const { data } = await supabase.from("daily_completions").select("day, p").order("day", { ascending: false }).limit(1000);
  const streak = computeStreak(((data ?? []) as { day: string; p: number }[]).map((d) => ({ day: d.day, p: Number(d.p) })), today);
  if (!streak.lastBreak) return { ok: true };
  const { error } = await supabase
    .from("streak_state")
    .update({ broken_on: streak.lastBreak.on, broken_length: streak.lastBreak.length, best: streak.best, current: streak.current })
    .not("user_id", "is", null);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export type DayDetail = {
  day: string;
  goals: { id: string; kind: string; title: string; text: string; tier: Tier; resultTier: Tier | null; userNote: string | null; skillName: string; color: string }[];
};

/** Calendar detail sheet: each goal that day, its tier, done or missed, and notes. */
export async function getDayDetail(day: string): Promise<DayDetail> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { day, goals: [] };
  const supabase = await createClient();
  const [goals, skills, cats] = await Promise.all([
    loadGoals(supabase, day, day),
    supabase.from("skills").select("id, name, category_id"),
    supabase.from("categories").select("id, color"),
  ]);
  const color = new Map(((cats.data ?? []) as { id: string; color: string }[]).map((c) => [c.id, c.color]));
  const skill = new Map(((skills.data ?? []) as { id: string; name: string; category_id: string }[]).map((s) => [s.id, s]));
  return {
    day,
    goals: goals.map((g) => ({
      id: g.id,
      kind: g.kind,
      title: g.title,
      text: g.text,
      tier: g.tier,
      resultTier: g.result_tier,
      userNote: g.user_note,
      skillName: skill.get(g.skill_id)?.name ?? "",
      color: color.get(skill.get(g.skill_id)?.category_id ?? "") ?? "#8E8A84",
    })),
  };
}
