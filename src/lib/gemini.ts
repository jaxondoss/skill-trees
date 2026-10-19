import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { MEAL_PROMPT, MealSchema, sanitize, type MealAnalysis } from "./claude-prompts";

/**
 * Gemini for meal photos (Jaxon's food photos already live in Gemini), server only, through Google's
 * official SDK. Optional: without GEMINI_API_KEY the app uses Claude if that key is set, else quick-add.
 * GEMINI_MODEL overrides the model; the default alias tracks Google's current Flash model.
 */
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);
const model = () => process.env.GEMINI_MODEL || "gemini-flash-latest";

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

/** Meal photo to a nutrition table; the user confirms portions before anything is saved (spec 12.10). */
export async function analyzeMealWithGemini(imageBase64: string, mimeType: "image/jpeg" | "image/png" | "image/webp"): Promise<MealAnalysis> {
  let text: string | undefined;
  try {
    const res = await gemini().models.generateContent({
      model: model(),
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: MEAL_PROMPT }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(MealSchema) },
    });
    text = res.text;
  } catch (err) {
    throw friendly(err);
  }
  const parsed = MealSchema.safeParse(safeJson(text));
  if (!parsed.success) throw new Error("Could not read this photo. Use quick-add instead.");
  return { ...parsed.data, notes: sanitize(parsed.data.notes) };
}

function safeJson(text: string | undefined): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
