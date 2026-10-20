"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { Tier } from "@/engine/types";
import { autoClaim } from "@/lib/data/claims";
import { loadProfile, loadUserContext, todayFor } from "@/lib/data/context";
import { syncProvider } from "@/lib/data/integrations";
import { chessAdapter } from "@/integrations/chess";
import { lyftaAdapter } from "@/integrations/lyfta";
import { geminiAvailable, pingGemini } from "@/lib/gemini";
import type { ProviderId } from "@/integrations/types";
import { passageById, scoreReading, wordCount } from "@/content/reading-passages";
import { aiAvailable, readingTest, readMealPhoto } from "@/lib/ai";
import type { MealAnalysis, ReadingTest } from "@/lib/claude-prompts";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const fail = (error: string): ActionResult => ({ ok: false, error });

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const profile = await loadProfile(supabase);
  return { supabase, uid, profile, today: todayFor(profile, new Date()) };
}

async function skillId(supabase: Awaited<ReturnType<typeof createClient>>, slug: string): Promise<string | null> {
  const { data } = await supabase.from("skills").select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function claimAndRefresh(supabase: Awaited<ReturnType<typeof createClient>>) {
  await autoClaim(supabase, await loadUserContext(supabase, new Date()));
  refresh();
}

// ───────────────────────────── Integrations

const ChessInput = z.object({ platform: z.enum(["lichess", "chess.com"]), username: z.string(), timeControl: z.enum(["rapid", "blitz", "classical"]) });

/** Connects the chess account (public data, username only) and syncs right away. */
export async function connectChess(input: z.infer<typeof ChessInput>): Promise<ActionResult> {
  const parsed = ChessInput.safeParse(input);
  if (!parsed.success) return fail("Pick a platform and time control.");
  let config;
  try {
    config = chessAdapter.connect(parsed.data);
  } catch {
    return fail("That username does not look right.");
  }
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase.from("integrations").upsert({ user_id: uid, provider: "chess", config, status: "connected" }, { onConflict: "user_id,provider" });
  if (error) return fail(error.message);
  await supabase.from("skills").update({ config: { platform: config.platform, username: config.username, timeControl: config.timeControl } }).eq("slug", "chess");
  const r = await syncProvider(supabase, uid, "chess", today);
  await claimAndRefresh(supabase);
  return r.ok ? { ok: true } : fail(`Saved, but the first sync failed: ${r.error}`);
}

export async function syncNow(provider: ProviderId): Promise<ActionResult> {
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const r = await syncProvider(supabase, uid, provider, today);
  await claimAndRefresh(supabase);
  return r.ok ? { ok: true } : fail(r.error ?? "Sync failed.");
}

const LyftaInput = z.object({ unit: z.enum(["lb", "kg"]) });

/** Connects Lyfta with LYFTA_API_KEY from the server env and pulls the last 30 days right away. */
export async function connectLyfta(input: z.infer<typeof LyftaInput>): Promise<ActionResult> {
  const parsed = LyftaInput.safeParse(input);
  if (!parsed.success) return fail("Pick lb or kg.");
  if (!process.env.LYFTA_API_KEY) return fail("LYFTA_API_KEY is not set in Vercel yet. Add it, redeploy, then connect.");
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase
    .from("integrations")
    .upsert({ user_id: uid, provider: "lyfta", config: lyftaAdapter.connect(parsed.data), status: "connected" }, { onConflict: "user_id,provider" });
  if (error) return fail(error.message);
  const r = await syncProvider(supabase, uid, "lyfta", today);
  await claimAndRefresh(supabase);
  return r.ok ? { ok: true } : fail(`Saved, but the first sync failed: ${r.error}`);
}

/** A one-word round trip to Gemini, so Settings can confirm the key works. */
export async function testGemini(): Promise<ActionResult> {
  if (!geminiAvailable()) return fail("GEMINI_API_KEY is not set in Vercel yet.");
  const { uid } = await session();
  if (!uid) return fail("Sign in again.");
  try {
    await pingGemini();
    return { ok: true };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Gemini did not answer.");
  }
}

/** Disconnecting keeps every number already synced; manual entry takes over. */
export async function disconnect(provider: ProviderId): Promise<ActionResult> {
  const { supabase } = await session();
  const { error } = await supabase.from("integrations").delete().eq("provider", provider);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

// ───────────────────────────── Assignments (Canvas fallback)

const Assignment = z.object({
  name: z.string().trim().min(1).max(200),
  course: z.string().trim().max(40).nullable(),
  dueAt: z.string().datetime({ offset: true }),
});

export async function addAssignment(input: z.infer<typeof Assignment>): Promise<ActionResult> {
  const parsed = Assignment.safeParse(input);
  if (!parsed.success) return fail("Give it a name and a due date and time.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase.from("assignments").insert({ user_id: uid, name: parsed.data.name, course: parsed.data.course || null, due_at: parsed.data.dueAt });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function updateAssignment(id: string, patch: { started?: boolean; submitted?: boolean }): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail("Unknown assignment.");
  const { supabase } = await session();
  const { error } = await supabase.from("assignments").update(patch).eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function deleteAssignment(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail("Unknown assignment.");
  const { supabase } = await session();
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

// ───────────────────────────── Daily trackers

/** One tap at night ("sleep") and one in the morning ("wake"). */
export async function logSleep(event: "sleep" | "wake"): Promise<ActionResult> {
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const now = new Date();
  if (event === "sleep") {
    const { error } = await supabase.from("sleep_sessions").insert({ user_id: uid, day: today, slept_at: now.toISOString() });
    if (error) return fail(error.message);
  } else {
    const { data } = await supabase
      .from("sleep_sessions")
      .select("id, slept_at")
      .is("woke_at", null)
      .gte("slept_at", new Date(now.getTime() - 18 * 3_600_000).toISOString())
      .order("slept_at", { ascending: false })
      .limit(1);
    const open = (data ?? [])[0] as { id: string } | undefined;
    if (!open) return fail("No bedtime logged in the last 18 hours.");
    const { error } = await supabase.from("sleep_sessions").update({ woke_at: now.toISOString() }).eq("id", open.id);
    if (error) return fail(error.message);
  }
  await claimAndRefresh(supabase);
  return { ok: true };
}

const DAILY_KEYS = { gut_rating: { skill: "gut-health", min: 1, max: 5 }, block_adherence_pct: { skill: "time-blocking", min: 0, max: 100 } } as const;

/** One-tap daily value (gut rating, block adherence). Re-tapping replaces today's value. */
export async function logDaily(key: keyof typeof DAILY_KEYS, value: number): Promise<ActionResult> {
  const def = DAILY_KEYS[key];
  if (!def || !Number.isFinite(value) || value < def.min || value > def.max) return fail("Out of range.");
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  await supabase.from("metrics").delete().eq("key", key).eq("day", today).eq("source", "manual");
  const { error } = await supabase.from("metrics").insert({ user_id: uid, skill_id: await skillId(supabase, def.skill), key, value, day: today, source: "manual" });
  if (error) return fail(error.message);
  await claimAndRefresh(supabase);
  return { ok: true };
}

const Meal = z.object({ calories: z.number().min(0).max(5000), proteinG: z.number().min(0).max(400), fiberG: z.number().min(0).max(150) });

/** Meal quick-add (the fallback for photo analysis). */
export async function addMeal(input: z.infer<typeof Meal>): Promise<ActionResult> {
  const parsed = Meal.safeParse(input);
  if (!parsed.success) return fail("Check the numbers.");
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const food = await skillId(supabase, "food");
  const mealId = crypto.randomUUID();
  const rows = [
    ["meal_calories", parsed.data.calories],
    ["meal_protein_g", parsed.data.proteinG],
    ["meal_fiber_g", parsed.data.fiberG],
  ].map(([key, value]) => ({ user_id: uid, skill_id: food, key, value, day: today, source: "manual", meta: { mealId } }));
  const { error } = await supabase.from("metrics").insert(rows);
  if (error) return fail(error.message);
  await claimAndRefresh(supabase);
  return { ok: true };
}

/** Completes today's open goal for a skill (meditation timer, WOOP flow). */
export async function completeSkillGoalToday(slug: string, tier: Tier): Promise<ActionResult> {
  const { supabase, today } = await session();
  const sid = await skillId(supabase, slug);
  if (!sid) return fail("Unknown skill.");
  const { data } = await supabase
    .from("plan_goals")
    .select("id, daily_plans!inner(day)")
    .eq("skill_id", sid)
    .eq("daily_plans.day", today)
    .neq("kind", "stretch")
    .is("result_tier", null)
    .limit(1);
  const goal = (data ?? [])[0] as { id: string } | undefined;
  if (goal) {
    const { error } = await supabase.from("plan_goals").update({ result_tier: tier, completed_at: new Date().toISOString() }).eq("id", goal.id);
    if (error) return fail(error.message);
  }
  refresh();
  return { ok: true };
}

const Woop = z.object({ wish: z.string().trim().min(1).max(200), outcome: z.string().trim().min(1).max(200), obstacle: z.string().trim().min(1).max(200), plan: z.string().trim().min(1).max(200) });

/** Guided WOOP (spec 12.15): saved to the Visualization log, and today's goal completes at Standard. */
export async function saveWoop(input: z.infer<typeof Woop>): Promise<ActionResult> {
  const parsed = Woop.safeParse(input);
  if (!parsed.success) return fail("Fill all four parts.");
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const w = parsed.data;
  const body = `WOOP. Wish: ${w.wish}. Outcome: ${w.outcome}. Obstacle: ${w.obstacle}. Plan: ${w.plan}`.slice(0, 500);
  const { error } = await supabase.from("skill_logs").insert({ user_id: uid, skill_id: await skillId(supabase, "visualization"), day: today, body });
  if (error) return fail(error.message);
  return completeSkillGoalToday("visualization", "standard");
}

// ───────────────────────────── Reading tests (spec 12.4)

const ReadingResult = z.object({
  passageId: z.string().max(60).nullable(),
  words: z.number().int().min(100).max(2000),
  seconds: z.number().min(15).max(3600),
  correct: z.number().int().min(0).max(10),
  total: z.number().int().min(1).max(10),
});

/** Saves one timed test as an effective rate, with wpm and comprehension kept alongside. */
export async function saveReadingTest(input: z.infer<typeof ReadingResult>): Promise<ActionResult> {
  const parsed = ReadingResult.safeParse(input);
  if (!parsed.success || parsed.data.correct > parsed.data.total) return fail("That result does not look right.");
  const r = parsed.data;
  // Curated passages: count the words on the server, not from the client.
  const curated = r.passageId ? passageById(r.passageId) : undefined;
  const words = curated ? wordCount(curated.text) : r.words;
  const score = scoreReading(words, r.seconds, r.correct, r.total);
  if (score.wpm > 2000) return fail("Over 2,000 wpm is not a real reading speed. Read it again.");
  const { supabase, uid, today } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase.from("metrics").insert({
    user_id: uid,
    skill_id: await skillId(supabase, "reading"),
    key: "reading_effective_rate",
    value: Math.round(score.effectiveRate),
    unit: "wpm",
    day: today,
    source: "reading_test",
    meta: { passageId: r.passageId, words, seconds: Math.round(r.seconds), wpm: Math.round(score.wpm), comprehensionPct: Math.round(score.comprehensionPct) },
  });
  if (error) return fail(error.message);
  await claimAndRefresh(supabase);
  return { ok: true };
}

export type ActionData<T> = { ok: true; data: T } | { ok: false; error: string };

/** Optional: a fresh passage from Gemini (or Claude) when a key is set. */
export async function generateReadingPassage(topic: string): Promise<ActionData<ReadingTest>> {
  const clean = topic.trim().slice(0, 80);
  if (!clean) return { ok: false, error: "Name a topic." };
  if (!aiAvailable()) return { ok: false, error: "AI is not connected. Use a curated passage." };
  const { uid } = await session();
  if (!uid) return { ok: false, error: "Sign in again." };
  try {
    return { ok: true, data: await readingTest(clean) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not generate a passage." };
  }
}

// ───────────────────────────── Meal photos (spec 12.10)

const MEDIA = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_PHOTO_BYTES = 4_500_000;

/** Reads a meal photo into an editable table with Gemini (or Claude). Nothing is saved until the user confirms. */
export async function analyzeMealPhoto(form: FormData): Promise<ActionData<MealAnalysis>> {
  if (!aiAvailable()) return { ok: false, error: "Photo reading is not connected. Use quick-add." };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo." };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too large. Try one under 4.5 MB." };
  const media = MEDIA.find((m) => m === file.type);
  if (!media) return { ok: false, error: "Use a JPEG, PNG, or WebP photo." };
  const { uid } = await session();
  if (!uid) return { ok: false, error: "Sign in again." };
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    return { ok: true, data: await readMealPhoto(base64, media) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read the photo." };
  }
}
