import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateEntries, deriveFromHistory } from "@/engine/metrics";
import { milestonesToClaim } from "@/engine/scoring";
import type { UserContext } from "./context";

/** Current value of every metric and derived counter, for progress bars and auto-claims. */
export function metricValues(ctx: UserContext): Record<string, number> {
  const slugById = new Map(ctx.skills.map((s) => [s.id, s.slug]));
  return {
    ...aggregateEntries(ctx.metrics.map((m) => ({ key: m.key, value: m.value, day: m.day, recordedAt: m.recorded_at }))),
    ...deriveFromHistory(ctx.history, slugById, ctx.today),
  };
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
