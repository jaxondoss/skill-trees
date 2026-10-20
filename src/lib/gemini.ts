import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  debriefPrompt,
  MEAL_PROMPT,
  MealSchema,
  readingTestPrompt,
  ReadingTestSchema,
  sanitize,
  STYLE,
  validReadingTest,
  type MealAnalysis,
  type ReadingTest,
  type WeeklyFacts,
} from "./claude-prompts";

/**
 * Gemini does the app's AI work by default (meal photos, weekly debrief, reading tests), server only,
 * through Google's official SDK. Optional: without GEMINI_API_KEY the app falls back to Claude if
 * ANTHROPIC_API_KEY is set, else to manual entry. A Google AI Pro subscription does not cover API calls:
 * the key runs on the API's free tier unless billing is turned on for it in Google AI Studio.
 *
 * Models are tried in order, each with its own time limit, because the newest Flash model can be slow
 * or overloaded on the free tier (measured 2026-10-20: 3.5 Flash answered in 2 s, the latest Flash in
 * up to 60 s). GEMINI_MODEL, if set, goes first. A rejected key stops the chain; it never falls through.
 */
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);
export const MODEL_CHAIN = [
  { model: "gemini-3.5-flash", timeoutMs: 25_000 },
  { model: "gemini-flash-latest", timeoutMs: 20_000 },
  { model: "gemini-flash-lite-latest", timeoutMs: 15_000 },
];
const chain = () => (process.env.GEMINI_MODEL ? [{ model: process.env.GEMINI_MODEL, timeoutMs: 25_000 }, ...MODEL_CHAIN] : MODEL_CHAIN);

/** Worth trying the next model: overloaded, rate limited, retired, or too slow. Not a bad key or a bad request. */
export const retryable = (err: unknown) =>
  err instanceof ApiError ? [404, 429, 500, 503, 504].includes(err.status) : err instanceof Error && /abort|timeout/i.test(`${err.name} ${err.message}`);

let client: GoogleGenAI | null = null;
const gemini = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

function friendly(err: unknown): Error {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 401 || err.status === 403) return new Error("The Gemini API key was rejected, or the model is not available to it.");
    if (err.status === 429) return new Error("Gemini is rate limited right now. Try again in a minute.");
    return new Error(`Gemini request failed (${err.status}).`);
  }
  return err instanceof Error ? err : new Error("Gemini request failed.");
}

type Request = Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">;

async function generate(params: Request): Promise<string> {
  let last: unknown = null;
  for (const { model, timeoutMs } of chain()) {
    try {
      const res = await gemini().models.generateContent({ ...params, model, config: { ...params.config, abortSignal: AbortSignal.timeout(timeoutMs) } });
      return res.text ?? "";
    } catch (err) {
      last = err;
      if (!retryable(err)) break;
    }
  }
  throw friendly(last);
}

function json<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A one-word round trip, for the connection check in Settings. */
export async function pingGemini(): Promise<void> {
  const text = await generate({ contents: "Reply with the single word OK." });
  if (!text.trim()) throw new Error("Gemini answered with nothing.");
}

/** Meal photo to a nutrition table; the user confirms portions before anything is saved (spec 12.10). */
export async function analyzeMealWithGemini(imageBase64: string, mimeType: "image/jpeg" | "image/png" | "image/webp"): Promise<MealAnalysis> {
  const text = await generate({
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: MEAL_PROMPT }] }],
    config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(MealSchema) },
  });
  const meal = json(MealSchema, text);
  if (!meal) throw new Error("Could not read this photo. Use quick-add instead.");
  return { ...meal, notes: sanitize(meal.notes) };
}

/** Short, direct weekly debrief from the week's facts (spec 4.4). */
export async function writeDebriefWithGemini(facts: WeeklyFacts): Promise<string> {
  const text = await generate({ contents: debriefPrompt(facts), config: { systemInstruction: STYLE } });
  if (!text.trim()) throw new Error("Gemini did not write a debrief. Try again.");
  return sanitize(text);
}

/** A fresh timed reading passage with 5 questions (spec 12.4). */
export async function generateReadingTestWithGemini(topic: string): Promise<ReadingTest> {
  const text = await generate({
    contents: readingTestPrompt(topic),
    config: { systemInstruction: STYLE, responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(ReadingTestSchema) },
  });
  const test = json(ReadingTestSchema, text);
  if (!test || !validReadingTest(test)) throw new Error("The generated test was not usable. Try again or use a curated passage.");
  return {
    title: sanitize(test.title),
    passage: test.passage.replace(/\u2014/g, ", "),
    questions: test.questions.map((q) => ({ ...q, question: sanitize(q.question), options: q.options.map(sanitize) })),
  };
}
