import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateEntries, deriveFromHistory } from "@/engine/metrics";
import { adherenceDerived, DEFAULT_SLEEP, foodDerived, nights, ratingDerived, sleepDerived, type SleepConfig } from "@/engine/trackers";
import { milestonesToClaim } from "@/engine/scoring";
import type { UserContext } from "./context";

/** Sleep anchor settings and the day the 15-minute weekly shift started. */
export function sleepSettings(ctx: UserContext): { cfg: SleepConfig; startDay: string } {
  const sleep = ctx.skills.find((s) => s.slug === "sleep");
  const c = (sleep?.config ?? {}) as Partial<SleepConfig>;
  const cfg = { ...DEFAULT_SLEEP, ...Object.fromEntries(Object.entries(c).filter(([k]) => k in DEFAULT_SLEEP)) } as SleepConfig;
  const startDay = (ctx.profile.onboarded_at ?? sleep?.created_at ?? new Date().toISOString()).slice(0, 10);
  return { cfg, startDay };
}

export function foodTargets(ctx: UserContext) {
  const c = (ctx.skills.find((s) => s.slug === "food")?.config ?? {}) as { caloriesTarget?: number; proteinTargetG?: number; calorieTolerancePct?: number };
  return { calories: c.caloriesTarget ?? 3500, proteinG: c.proteinTargetG ?? 200, calorieTolerancePct: c.calorieTolerancePct ?? 10 };
}

/** Current value of every metric and derived counter, for progress bars and auto-claims. */
export function metricValues(ctx: UserContext): Record<string, number> {
  const slugById = new Map(ctx.skills.map((s) => [s.id, s.slug]));
  const entries = ctx.metrics.map((m) => ({ key: m.key, value: m.value, day: m.day, recordedAt: m.recorded_at }));
  const { cfg, startDay } = sleepSettings(ctx);
  const sessions = ctx.sleepSessions.map((s) => ({ day: s.day, sleptAt: s.slept_at, wokeAt: s.woke_at }));
  const sources = [
    aggregateEntries(entries),
    deriveFromHistory(ctx.history, slugById, ctx.today),
    sleepDerived(nights(sessions, ctx.profile.timezone, startDay, cfg), ctx.today),
    foodDerived(entries, ctx.today, foodTargets(ctx)),
    ratingDerived(entries),
    adherenceDerived(entries),
  ];
  // Several sources can report the same counter (goal history and a tracker): take the larger.
  const out: Record<string, number> = {};
  for (const src of sources) for (const [k, v] of Object.entries(src)) out[k] = Math.max(out[k] ?? -Infinity, v);
  return out;
}

/**
 * Claims every metric, streak, and count milestone whose rule is now met (spec 6.3).
 * Dormant and archived skills are left alone. Returns the titles claimed.
 */
export async function autoClaim(supabase: SupabaseClient, ctx: UserContext): Promise<string[]> {
  const active = new Set(ctx.skills.filter((s) => s.status === "active").map((s) => s.id));
  const candidates = ctx.milestones.filter((m) => active.has(m.skill_id));
  const ids = milestonesToClaim(
    candidates.map((m) => ({ id: m.id, points: m.points, claimed: m.claimed_at !== null, rule: m.rule })),
    metricValues(ctx),
  );
  if (!ids.length) return [];
  const { error } = await supabase.from("milestones").update({ claimed_at: new Date().toISOString() }).in("id", ids).is("claimed_at", null);
  if (error) throw new Error(`Auto-claim failed: ${error.message}`);
  return candidates.filter((m) => ids.includes(m.id)).map((m) => m.title);
}
