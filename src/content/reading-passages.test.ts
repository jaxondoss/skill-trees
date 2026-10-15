import { describe, expect, it } from "vitest";
import { debriefPrompt, ReadingTestSchema, sanitize, validReadingTest } from "@/lib/claude-prompts";
import { PASSAGES, scoreReading, wordCount } from "./reading-passages";

describe("curated reading tests", () => {
  it("has passages of test length, each with 5 four-option questions", () => {
    expect(PASSAGES.length).toBeGreaterThanOrEqual(3);
    for (const p of PASSAGES) {
      expect(wordCount(p.text), p.id).toBeGreaterThan(350);
      expect(wordCount(p.text), p.id).toBeLessThan(500);
      expect(p.questions).toHaveLength(5);
      for (const q of p.questions) expect(q.options).toHaveLength(4);
      expect(validReadingTest(ReadingTestSchema.parse({ title: p.title, passage: p.text, questions: p.questions }))).toBe(true);
    }
    expect(new Set(PASSAGES.map((p) => p.id)).size).toBe(PASSAGES.length);
  });

  it("scores wpm, comprehension, and effective rate", () => {
    const s = scoreReading(400, 80, 4, 5);
    expect(s.wpm).toBe(300);
    expect(s.comprehensionPct).toBe(80);
    expect(s.effectiveRate).toBe(240);
  });
});

describe("claude prompt helpers", () => {
  it("removes em and en dashes from model text", () => {
    expect(sanitize("Strong week \u2014 keep it up")).toBe("Strong week, keep it up");
    expect(sanitize("Days 3\u20135")).toBe("Days 3 to 5");
  });

  it("builds the debrief from facts only", () => {
    const prompt = debriefPrompt({
      weekStart: "2026-10-12",
      completionPct: 78.4,
      keptDays: 4,
      streak: 2,
      best: 6,
      overall: { now: 31.2, weekAgo: 29, tier: "Awakened" },
      riser: { name: "Strength", delta: 3.1 },
      slipper: { name: "Chess", delta: -2.4 },
      missedMost: [{ name: "Time Blocking", missed: 3, scheduled: 7 }],
      obstacle: "Late nights before Calc quiz",
      focusLine: "Win the morning",
    });
    expect(prompt).toContain("averaged 78%");
    expect(prompt).toContain("4 of 7 days reached 85%");
    expect(prompt).toContain("2.2 vs last week");
    expect(prompt).toContain("Time Blocking 3 of 7");
    expect(prompt).toContain('"Win the morning"');
    expect(prompt).toContain("Do not invent numbers");
  });

  it("rejects malformed generated tests", () => {
    const bad = { title: "x", passage: "too short", questions: [] };
    expect(validReadingTest(bad)).toBe(false);
  });
});
