import { SEED_TEMPLATE } from "./template";
import type { SeedTemplate } from "./types";

/**
 * What a new account starts with (spec v2 r2, 7): the categories, skills, rack and schedule, with every
 * skill's goals and steps left as an empty to-do list. The full template stays as starter ideas.
 */
export function startingTemplate(t: SeedTemplate = SEED_TEMPLATE): SeedTemplate {
  return {
    ...t,
    categories: t.categories.map((c) => ({
      ...c,
      skills: c.skills.map((s) => ({ ...s, identity: "", hundredMeans: "", nonNegotiables: [], milestones: [] })),
    })),
  };
}
