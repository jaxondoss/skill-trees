import { describe, expect, it } from "vitest";
import { SEED_TEMPLATE } from "./template";

const skills = SEED_TEMPLATE.categories.flatMap((c) => c.skills.map((s) => ({ ...s, category: c.slug })));

describe("seed template", () => {
  it("has the five categories in dashboard order", () => {
    expect(SEED_TEMPLATE.categories.map((c) => c.slug)).toEqual(["business", "school", "mind", "athletics", "nutrition"]);
  });

  it("has 15 skills, 14 active and Triathlon dormant", () => {
    expect(skills).toHaveLength(15);
    expect(skills.filter((s) => s.status === "active")).toHaveLength(14);
    expect(skills.find((s) => s.slug === "triathlon")?.status).toBe("dormant");
  });

  it.each(skills.map((s) => [s.name, s] as const))("%s milestones sum to 100", (_, skill) => {
    expect(skill.milestones.reduce((sum, m) => sum + m.points, 0)).toBe(100);
  });

  it("uses category goal weights from spec 7.2", () => {
    const w = Object.fromEntries(SEED_TEMPLATE.categories.map((c) => [c.slug, c.goalWeight]));
    expect(w).toEqual({ business: 1.3, athletics: 1.3, mind: 1.2, school: 1.0, nutrition: 1.0 });
  });

  it("gives every skill a non-negotiable with all tiers, minutes ordered, and an intention", () => {
    for (const s of skills) {
      expect(s.nonNegotiables.length, s.name).toBeGreaterThan(0);
      for (const n of s.nonNegotiables) {
        expect(n.floor && n.standard && n.stretch && n.intention, s.name).toBeTruthy();
        expect(n.minutes.floor, s.name).toBeLessThanOrEqual(n.minutes.standard);
        expect(n.minutes.standard, s.name).toBeLessThanOrEqual(n.minutes.stretch);
        expect(n.daysOfWeek.length, s.name).toBeGreaterThan(0);
      }
    }
  });

  it("excludes training and zero-minute habits from the time budget", () => {
    const outside = skills.filter((s) => s.nonNegotiables.some((n) => !n.countsAgainstBudget)).map((s) => s.slug);
    expect(outside.sort()).toEqual(["food", "gut-health", "running", "sleep", "strength", "triathlon"]);
  });

  it("suggests exactly the five check-marked milestones at onboarding", () => {
    const suggested = skills.flatMap((s) => s.milestones.filter((m) => m.suggestClaim).map((m) => `${s.slug}: ${m.title}`));
    expect(suggested).toEqual([
      "ai-building: Completed CS50P and the UPenn AI certificate",
      "chess: Baseline rating recorded",
      "strength: Bench 225",
      "strength: Squat 315",
      "running: Long run 4 miles",
    ]);
  });

  it("only gives auto-claim rules to non-manual milestones", () => {
    for (const s of skills) for (const m of s.milestones) if (m.type === "manual") expect(m.rule, m.title).toBeUndefined();
  });

  it("pins five existing, active skills on the default rack", () => {
    expect(SEED_TEMPLATE.rack).toHaveLength(5);
    for (const slug of SEED_TEMPLATE.rack) expect(skills.find((s) => s.slug === slug)?.status).toBe("active");
  });

  it("has a schedule day for every weekday and unique skill slugs", () => {
    expect(SEED_TEMPLATE.schedule.days.map((d) => d.weekday).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(skills.map((s) => s.slug)).size).toBe(skills.length);
  });
});
