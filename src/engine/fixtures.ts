/** Test helpers: engine inputs built from the real seed template. Not used by the app. */
import { SEED_TEMPLATE } from "@/seed/template";
import type { EngineCategory, EngineSkill, GoalRecord, Tier } from "./types";

export const categories: EngineCategory[] = SEED_TEMPLATE.categories.map((c) => ({
  id: c.slug,
  slug: c.slug,
  name: c.name,
  goalWeight: c.goalWeight,
}));

/** Skills keyed by slug; ids are slugs, non-negotiable ids are "slug:0". */
export function seedSkills(overrides: Record<string, Partial<EngineSkill>> = {}): EngineSkill[] {
  return SEED_TEMPLATE.categories.flatMap((c) =>
    c.skills.map((s) => ({
      id: s.slug,
      slug: s.slug,
      name: s.name,
      categoryId: c.slug,
      status: s.status,
      priorityWeight: s.priorityWeight,
      score: 0,
      nonNegotiables: s.nonNegotiables.map((n, i) => ({
        id: `${s.slug}:${i}`,
        skillId: s.slug,
        name: n.name,
        text: { floor: n.floor, standard: n.standard, stretch: n.stretch },
        minutes: n.minutes,
        countsAgainstBudget: n.countsAgainstBudget,
        intention: n.intention,
        daysOfWeek: n.daysOfWeek,
        dayTypes: n.dayTypes ?? null,
        defaultTier: n.defaultTier,
      })),
      ...overrides[s.slug],
    })),
  );
}

export const schedule = SEED_TEMPLATE.schedule.days.map((d) => ({ weekday: d.weekday, dayType: d.dayType }));
export const defaultRack = SEED_TEMPLATE.rack;

/** A core goal record for the skill's first non-negotiable. */
export function rec(skill: string, day: string, result: Tier | null, kind: GoalRecord["kind"] = "rack"): GoalRecord {
  return { day, skillId: skill, nonNegotiableId: `${skill}:0`, kind, plannedTier: "standard", result };
}
