import { z } from "zod";

/**
 * Prompts and output schemas for the Claude features (spec 13): weekly debrief, reading test
 * generation, meal photo analysis. Pure, so they are unit tested without calling the API.
 */

export const STYLE =
  "Write in a direct, honest tone. No hype, no guilt, no generic motivational quotes. " +
  "Never use em dashes; use commas, colons, or periods instead. Plain text, no markdown headings.";

/** Model text sometimes contains em dashes; the app's copy rule forbids them (spec 0.6). */
export function sanitize(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ", ").replace(/\s*\u2013\s*/g, " to ").trim();
}

export type WeeklyFacts = {
  weekStart: string;
  completionPct: number | null;
  keptDays: number;
  streak: number;
  best: number;
  overall: { now: number; weekAgo: number | null; tier: string };
  riser: { name: string; delta: number } | null;
  slipper: { name: string; delta: number } | null;
  missedMost: { name: string; missed: number; scheduled: number }[];
  obstacle: string;
  focusLine: string;
};

export function debriefPrompt(f: WeeklyFacts): string {
  const lines = [
    `Week starting ${f.weekStart}.`,
    `Daily completion averaged ${f.completionPct === null ? "unknown" : `${Math.round(f.completionPct)}%`}; ${f.keptDays} of 7 days reached 85%.`,
    `Streak ${f.streak} (best ${f.best}). Overall score ${f.overall.now.toFixed(1)} (${f.overall.tier})${f.overall.weekAgo === null ? "" : `, ${(f.overall.now - f.overall.weekAgo).toFixed(1)} vs last week`}.`,
    f.riser ? `Biggest riser: ${f.riser.name} (+${f.riser.delta.toFixed(1)}).` : "",
    f.slipper ? `Biggest slipper: ${f.slipper.name} (${f.slipper.delta.toFixed(1)}).` : "",
    f.missedMost.length ? `Most missed: ${f.missedMost.map((m) => `${m.name} ${m.missed} of ${m.scheduled}`).join(", ")}.` : "",
    f.obstacle ? `What got in the way, in their own words: "${f.obstacle}"` : "",
    f.focusLine ? `Next week's focus line: "${f.focusLine}"` : "",
  ].filter(Boolean);
  return [
    "You are writing a short weekly debrief for a college student's personal skill tracker.",
    "Using only the facts below, write 4 to 6 sentences: what went well, what slipped and the most likely reason, and one concrete adjustment for next week tied to the focus line. Do not invent numbers.",
    "",
    ...lines,
  ].join("\n");
}

export const ReadingTestSchema = z.object({
  title: z.string(),
  passage: z.string().describe("An original nonfiction passage of 380 to 450 words, plain paragraphs separated by blank lines."),
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).describe("Exactly 4 options."),
        answerIndex: z.number().int().describe("0-based index of the correct option."),
      }),
    )
    .describe("Exactly 5 comprehension questions that test understanding, not trivia."),
});
export type ReadingTest = z.infer<typeof ReadingTestSchema>;

export function readingTestPrompt(topic: string): string {
  return [
    `Write an original nonfiction reading passage about ${topic} for a timed reading test, at the level of a quality magazine article.`,
    "Then write 5 multiple-choice comprehension questions with 4 options each. Questions should check main ideas, reasoning, and inference, and each must be answerable only from the passage.",
  ].join("\n");
}

/** A generated test is usable only if it has 5 well-formed questions and a passage of a sensible length. */
export function validReadingTest(t: ReadingTest): boolean {
  const words = t.passage.trim().split(/\s+/).length;
  return words >= 250 && words <= 700 && t.questions.length === 5 && t.questions.every((q) => q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex < 4);
}

export const MealSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      portion: z.string().describe("Estimated portion in everyday units, e.g. '1 cup', '6 oz'."),
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
      fiberG: z.number(),
      sodiumMg: z.number(),
      potassiumMg: z.number(),
      magnesiumMg: z.number(),
    }),
  ),
  notes: z.string().describe("One short sentence on what was hard to see or estimate."),
});
export type MealAnalysis = z.infer<typeof MealSchema>;

export const MEAL_PROMPT =
  "Identify each visible food in this meal photo and estimate its portion and nutrition: calories, protein, carbs, fat, fiber (g), sodium, potassium, magnesium (mg). " +
  "The user is an athlete on a lean bulk who will confirm portions before saving, so give your best single estimate per item rather than ranges.";
