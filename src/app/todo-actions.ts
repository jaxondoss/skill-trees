"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { METRIC_BY_KEY } from "@/engine/metrics";
import { loadProfile, todayFor } from "@/lib/data/context";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

/**
 * The to-do lists on skill pages and Today (spec v2 r2, 5 and 7): goals are `non_negotiables` (repeating),
 * steps are `milestones` (one time). Plus the journal, saved to Mind.
 */

export type ActionData<T> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(140);

async function client() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return { supabase, uid };
}

/**
 * Add a goal to a skill. It repeats every day until edited; the wording starts as the title for every tier.
 * With `today`, it also joins today's plan (Rack if the skill is pinned, otherwise Balance).
 */
export async function addGoal(skillId: string, name: string, opts: { today?: boolean } = {}): Promise<ActionData<{ id: string }>> {
  const t = title.safeParse(name);
  if (!uuid.safeParse(skillId).success || !t.success) return fail("Give the goal a name.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const { count } = await supabase.from("non_negotiables").select("id", { count: "exact", head: true }).eq("skill_id", skillId);
  const { data, error } = await supabase
    .from("non_negotiables")
    .insert({ user_id: uid, skill_id: skillId, name: t.data, floor_text: t.data, standard_text: t.data, stretch_text: t.data, sort: count ?? 0 })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not add the goal.");

  if (opts.today) {
    const profile = await loadProfile(supabase);
    const today = todayFor(profile, new Date());
    const [{ data: plan }, { data: pin }] = await Promise.all([
      supabase.from("daily_plans").select("id").eq("day", today).maybeSingle(),
      supabase.from("rack_pins").select("slot").eq("skill_id", skillId).maybeSingle(),
    ]);
    if (plan) {
      const { error: e2 } = await supabase.from("plan_goals").insert({
        user_id: uid,
        plan_id: plan.id,
        skill_id: skillId,
        non_negotiable_id: data.id,
        kind: pin ? "rack" : "balance",
        tier: "standard",
        title: t.data,
        text: t.data,
        sort: 99,
      });
      if (e2) return fail(e2.message);
    }
  }
  refresh();
  return { ok: true, data: { id: data.id } };
}

const tierText = z.string().trim().max(200);
const minutes = z.number().int().min(0).max(600);
const GoalPatch = z.object({
  name: title,
  intention: z.string().trim().max(200),
  texts: z.object({ floor: tierText, standard: tierText, stretch: tierText }),
  minutes: z.object({ floor: minutes, standard: minutes, stretch: minutes }),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

/** Fill in a goal's details. Empty tier wording falls back to the goal's name. Applies from the next plan. */
export async function updateGoal(id: string, patch: z.infer<typeof GoalPatch>): Promise<ActionResult> {
  const parsed = GoalPatch.safeParse(patch);
  if (!uuid.safeParse(id).success || !parsed.success) return fail("Give it a name and pick at least one day.");
  const p = parsed.data;
  const or = (s: string) => s || p.texts.standard || p.name;
  const { supabase } = await client();
  const { error } = await supabase
    .from("non_negotiables")
    .update({
      name: p.name,
      intention: p.intention,
      floor_text: or(p.texts.floor),
      standard_text: or(p.texts.standard),
      stretch_text: or(p.texts.stretch),
      floor_min: p.minutes.floor,
      standard_min: p.minutes.standard,
      stretch_min: p.minutes.stretch,
      days_of_week: [...new Set(p.daysOfWeek)].sort(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Remove a goal. Past logs keep their history; an unlogged copy on today's plan goes too. */
export async function deleteGoal(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Unknown goal.");
  const { supabase } = await client();
  await supabase.from("plan_goals").delete().eq("non_negotiable_id", id).is("result_tier", null);
  const { error } = await supabase.from("non_negotiables").delete().eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const points = z.number().int().min(1).max(100);

/** Add a step (a one-time milestone). Size sets the points: Small 5, Medium 10, Large 20. */
export async function addStep(skillId: string, name: string, pts = 10): Promise<ActionData<{ id: string }>> {
  const t = title.safeParse(name);
  if (!uuid.safeParse(skillId).success || !t.success || !points.safeParse(pts).success) return fail("Give the step a name.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const { count } = await supabase.from("milestones").select("id", { count: "exact", head: true }).eq("skill_id", skillId);
  const { data, error } = await supabase
    .from("milestones")
    .insert({ user_id: uid, skill_id: skillId, title: t.data, points: pts, type: "manual", sort: count ?? 0 })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not add the step.");
  refresh();
  return { ok: true, data: { id: data.id } };
}

const StepPatch = z.object({ title, note: z.string().trim().max(500), points });

export async function updateStep(id: string, patch: z.infer<typeof StepPatch>): Promise<ActionResult> {
  const parsed = StepPatch.safeParse(patch);
  if (!uuid.safeParse(id).success || !parsed.success) return fail("Give the step a name and 1 to 100 points.");
  const { supabase } = await client();
  const { error } = await supabase
    .from("milestones")
    .update({ title: parsed.data.title, note: parsed.data.note || null, points: parsed.data.points })
    .eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Delete a step. A claimed step keeps the level it earned, so only open steps can be deleted. */
export async function deleteStep(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Unknown step.");
  const { supabase } = await client();
  const { data, error } = await supabase.from("milestones").delete().eq("id", id).is("claimed_at", null).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Claimed steps stay: unclaim it first if it was a mistake.");
  refresh();
  return { ok: true };
}

/** Set or clear the identity line on a skill page. */
export async function saveIdentity(skillId: string, identity: string): Promise<ActionResult> {
  const v = z.string().trim().max(200).safeParse(identity);
  if (!uuid.safeParse(skillId).success || !v.success) return fail("Keep it under 200 characters.");
  const { supabase } = await client();
  const { error } = await supabase.from("skills").update({ identity: v.data || null }).eq("id", skillId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const MOODS = ["heavy", "strained", "steady", "clear", "locked_in"] as const;
const Journal = z.object({ body: z.string().trim().max(1000), mood: z.enum(MOODS).nullable() });

/** The journal: a quick note about the day and your head, saved under Mind. */
export async function saveJournal(input: z.infer<typeof Journal>): Promise<ActionData<{ id: string }>> {
  const parsed = Journal.safeParse(input);
  if (!parsed.success || (!parsed.data.body && !parsed.data.mood)) return fail("Write a line or pick how your head is.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const profile = await loadProfile(supabase);
  const body = parsed.data.body || `Head: ${parsed.data.mood!.replace("_", " ")}`;
  const { data, error } = await supabase
    .from("journal_entries")
    .insert({ user_id: uid, day: todayFor(profile, new Date()), body, mood: parsed.data.mood })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not save the entry.");
  refresh();
  return { ok: true, data: { id: data.id } };
}

export async function deleteJournal(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Unknown entry.");
  const { supabase } = await client();
  const { error } = await supabase.from("journal_entries").delete().eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const Meta = z.record(z.string().max(40), z.union([z.string().trim().max(140), z.number()])).refine((m) => Object.keys(m).length <= 6);

/**
 * Log a number from a skill's visualization, with details in meta (a ship's title, a course, a book, a person).
 * `replaceToday` replaces today's entries for the key first (for one-a-day values like habits).
 */
export async function logEntry(
  skillId: string,
  key: string,
  value: number,
  meta: Record<string, string | number> = {},
  opts: { replaceToday?: boolean; match?: Record<string, string> } = {},
): Promise<ActionResult> {
  const def = METRIC_BY_KEY.get(key);
  const m = Meta.safeParse(meta);
  if (!def || !uuid.safeParse(skillId).success || !m.success) return fail("Unknown entry.");
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return fail("Enter a valid number.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const profile = await loadProfile(supabase);
  const day = todayFor(profile, new Date());
  if (opts.replaceToday) {
    let q = supabase.from("metrics").delete().eq("key", key).eq("day", day).eq("skill_id", skillId);
    for (const [k, v] of Object.entries(opts.match ?? {})) q = q.eq(`meta->>${k}`, v);
    await q;
  }
  const { error } = await supabase.from("metrics").insert({ user_id: uid, skill_id: skillId, key, value, unit: def.unit || null, day, source: "manual", meta: m.data });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/**
 * "Start with empty lists" (spec v2 r2, 7): removes every goal and every unclaimed step, and today's unlogged
 * goals, so each skill starts as an empty to-do list. Claimed steps stay, so no level is lost.
 */
export async function clearStarterLists(confirmation: string): Promise<ActionData<{ goals: number; steps: number }>> {
  if (confirmation.trim().toLowerCase() !== "clear") return fail('Type "clear" to confirm.');
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const profile = await loadProfile(supabase);
  const today = todayFor(profile, new Date());
  const { data: plan } = await supabase.from("daily_plans").select("id").eq("day", today).maybeSingle();
  if (plan) await supabase.from("plan_goals").delete().eq("plan_id", plan.id).is("result_tier", null);
  const goals = await supabase.from("non_negotiables").delete().eq("user_id", uid).select("id");
  if (goals.error) return fail(goals.error.message);
  const steps = await supabase.from("milestones").delete().eq("user_id", uid).is("claimed_at", null).select("id");
  if (steps.error) return fail(steps.error.message);
  refresh();
  return { ok: true, data: { goals: goals.data?.length ?? 0, steps: steps.data?.length ?? 0 } };
}
