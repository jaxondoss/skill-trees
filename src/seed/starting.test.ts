import { describe, expect, it } from "vitest";
import { startingTemplate } from "./starting";
import { SEED_TEMPLATE } from "./template";

describe("starting template", () => {
  const t = startingTemplate();
  const skills = t.categories.flatMap((c) => c.skills);

  it("keeps every category, skill, the rack and the schedule", () => {
    expect(t.categories.map((c) => c.slug)).toEqual(SEED_TEMPLATE.categories.map((c) => c.slug));
    expect(skills.map((s) => s.slug)).toEqual(SEED_TEMPLATE.categories.flatMap((c) => c.skills.map((s) => s.slug)));
    expect(t.rack).toEqual(SEED_TEMPLATE.rack);
    expect(t.schedule).toEqual(SEED_TEMPLATE.schedule);
  });

  it("leaves every skill with an empty to-do list", () => {
    for (const s of skills) {
      expect(s.nonNegotiables).toEqual([]);
      expect(s.milestones).toEqual([]);
      expect(s.identity).toBe("");
    }
  });

  it("does not change the template the starter ideas come from", () => {
    expect(SEED_TEMPLATE.categories[0]!.skills[0]!.nonNegotiables.length).toBeGreaterThan(0);
  });
});
