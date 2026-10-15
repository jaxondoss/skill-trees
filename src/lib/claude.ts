import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { debriefPrompt, MEAL_PROMPT, MealSchema, readingTestPrompt, ReadingTestSchema, sanitize, STYLE, validReadingTest, type MealAnalysis, type ReadingTest, type WeeklyFacts } from "./claude-prompts";

/**
 * Claude features (spec 13), server only. Every call is optional: without ANTHROPIC_API_KEY
 * the app works with manual entry and curated content.
 */
const MODEL = "claude-opus-5-5";
// On a policy decline, re-run on Anthropic's recommended fallback model instead of returning the refusal.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export class ClaudeUnavailable extends Error {}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function friendly(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error("The Anthropic API key was rejected.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Claude is rate limited right now. Try again in a minute.");
  if (err instanceof Anthropic.APIError) return new Error(`Claude request failed (${err.status ?? "network"}).`);
  return err instanceof Error ? err : new Error("Claude request failed.");
}

/** Short, direct weekly debrief from the week's facts (spec 4.4). */
export async function writeDebrief(facts: WeeklyFacts): Promise<string> {
  if (!claudeAvailable()) throw new ClaudeUnavailable("Set ANTHROPIC_API_KEY to enable the debrief.");
  try {
    const message = await anthropic().beta.messages.create({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: STYLE,
      messages: [{ role: "user", content: debriefPrompt(facts) }],
    });
    if (message.stop_reason === "refusal") throw new Error("Claude declined to write this debrief.");
    return sanitize(textOf(message));
  } catch (err) {
    throw friendly(err);
  }
}

/** A fresh timed reading passage with 5 questions (spec 12.4, Phase 7). */
export async function generateReadingTest(topic: string): Promise<ReadingTest> {
  if (!claudeAvailable()) throw new ClaudeUnavailable("Set ANTHROPIC_API_KEY to generate passages.");
  try {
    const message = await anthropic().beta.messages.parse({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReadingTestSchema) },
      system: STYLE,
      messages: [{ role: "user", content: readingTestPrompt(topic) }],
    });
    const test = message.parsed_output;
    if (message.stop_reason === "refusal" || !test || !validReadingTest(test)) throw new Error("The generated test was not usable. Try again or use a curated passage.");
    return {
      title: sanitize(test.title),
      passage: test.passage.replace(/\u2014/g, ", "),
      questions: test.questions.map((q) => ({ ...q, question: sanitize(q.question), options: q.options.map(sanitize) })),
    };
  } catch (err) {
    throw friendly(err);
  }
}

/** Meal photo to a nutrition table; the user confirms portions before anything is saved (spec 12.10). */
export async function analyzeMeal(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<MealAnalysis> {
  if (!claudeAvailable()) throw new ClaudeUnavailable("Set ANTHROPIC_API_KEY to analyze photos.");
  try {
    const message = await anthropic().beta.messages.parse({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(MealSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: MEAL_PROMPT },
          ],
        },
      ],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) throw new Error("Could not read this photo. Use quick-add instead.");
    return { ...message.parsed_output, notes: sanitize(message.parsed_output.notes) };
  } catch (err) {
    throw friendly(err);
  }
}
