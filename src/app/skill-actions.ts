"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { METRIC_BY_KEY } from "@/engine/metrics";
import { autoClaim } from "@/lib/data/claims";
import { loadProfile, loadUserContext, todayFor } from "@/lib/data/context";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const fail = (error: string): ActionResult => ({ ok: false, error });
const uuid = z.string().uuid();

async function client() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return { supabase, uid };
}

/** Claim a milestone by hand, optionally with a proof number or an uploaded photo path. */
export async function claimMilestone(id: string, proof?: { value?: number | null; path?: string | null }): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Unknown milestone.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  if (proof?.path && !proof.path.startsWith(`${uid}/`)) return fail("Proof must be in your own folder.");
  const { error } = await supabase
    .from("milestones")
    .update({
      claimed_at: new Date().toISOString(),
      proof_value: proof?.value ?? null,
      proof_url: proof?.path ?? null,
    })
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Undo a claim made by mistake. */
export async function unclaimMilestone(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Unknown milestone.");
  const { supabase } = await client();
  const { error } = await supabase.from("milestones").update({ claimed_at: null, proof_value: null, proof_url: null }).eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const NewMilestone = z.object({ title: z.string().trim().min(3).max(140), points: z.number().int().min(1).max(30) });

/** "Raise the ceiling": add a higher milestone once a skill reaches 100. */
export async function addMilestone(skillId: string, input: { title: string; points: number }): Promise<ActionResult> {
  const parsed = NewMilestone.safeParse(input);
  if (!uuid.safeParse(skillId).success || !parsed.success) return fail("Give it a title and 1 to 30 points.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const { count } = await supabase.from("milestones").select("id", { count: "exact", head: true }).eq("skill_id", skillId);
  const { error } = await supabase
    .from("milestones")
    .insert({ user_id: uid, skill_id: skillId, title: parsed.data.title, points: parsed.data.points, type: "manual", sort: count ?? 100 });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Manual metric entry (the fallback for every integration). Auto-claims any milestone it unlocks. */
export async function addMetric(skillId: string, key: string, value: number, day?: string): Promise<ActionResult> {
  const def = METRIC_BY_KEY.get(key);
  if (!def || !uuid.safeParse(skillId).success) return fail("Unknown metric.");
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return fail("Enter a valid number.");
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("Enter a valid date.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const profile = await loadProfile(supabase);
  const { error } = await supabase
    .from("metrics")
    .insert({ user_id: uid, skill_id: skillId, key, value, unit: def.unit || null, day: day ?? todayFor(profile, new Date()), source: "manual" });
  if (error) return fail(error.message);
  await autoClaim(supabase, await loadUserContext(supabase, new Date()));
  refresh();
  return { ok: true };
}

export async function deleteMetric(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Unknown entry.");
  const { supabase } = await client();
  const { error } = await supabase.from("metrics").delete().eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** One-line note in a skill's log. */
export async function addLog(skillId: string, body: string): Promise<ActionResult> {
  const text = body.trim().slice(0, 500);
  if (!text || !uuid.safeParse(skillId).success) return fail("Write something first.");
  const { supabase, uid } = await client();
  if (!uid) return fail("Sign in again.");
  const profile = await loadProfile(supabase);
  const { error } = await supabase.from("skill_logs").insert({ user_id: uid, skill_id: skillId, day: todayFor(profile, new Date()), body: text });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function markTipSeen(skillId: string, tier: "foundation" | "development" | "mastery"): Promise<ActionResult> {
  if (!uuid.safeParse(skillId).success) return fail("Unknown skill.");
  const { supabase } = await client();
  const { error } = await supabase.from("skills").update({ seen_tip_tier: tier }).eq("id", skillId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const SkillPatch = z.object({
  name: z.string().trim().min(2).max(60),
  identity: z.string().trim().max(200),
  priorityWeight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export async function updateSkill(skillId: string, patch: z.infer<typeof SkillPatch>): Promise<ActionResult> {
  const parsed = SkillPatch.safeParse(patch);
  if (!uuid.safeParse(skillId).success || !parsed.success) return fail("Check the name, identity, and weight.");
  const { supabase } = await client();
  const { error } = await supabase
    .from("skills")
    .update({ name: parsed.data.name, identity: parsed.data.identity, priority_weight: parsed.data.priorityWeight })
    .eq("id", skillId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const tierText = z.string().trim().min(1).max(200);
const minutes = z.number().int().min(0).max(600);
const NNPatch = z.object({
  texts: z.object({ floor: tierText, standard: tierText, stretch: tierText }),
  minutes: z.object({ floor: minutes, standard: minutes, stretch: minutes }),
  intention: z.string().trim().max(200),
  defaultTier: z.enum(["floor", "standard", "stretch"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

/** Edit a non-negotiable. Applies from the next plan; today's plan is left as generated. */
export async function updateNonNegotiable(id: string, patch: z.infer<typeof NNPatch>): Promise<ActionResult> {
  const parsed = NNPatch.safeParse(patch);
  if (!uuid.safeParse(id).success || !parsed.success) return fail("Every tier needs text, and pick at least one day.");
  const p = parsed.data;
  const { supabase } = await client();
  const { error } = await supabase
    .from("non_negotiables")
    .update({
      floor_text: p.texts.floor,
      standard_text: p.texts.standard,
      stretch_text: p.texts.stretch,
      floor_min: p.minutes.floor,
      standard_min: p.minutes.standard,
      stretch_min: p.minutes.stretch,
      intention: p.intention,
      default_tier: p.defaultTier,
      days_of_week: [...new Set(p.daysOfWeek)].sort(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/**
 * Archive (to the Trophy Room, keeping its final score), make dormant, or awaken/restore.
 * A skill locked on the rack cannot be archived or put to sleep until the lock expires.
 */
export async function setSkillStatus(skillId: string, status: "active" | "dormant" | "archived"): Promise<ActionResult> {
  if (!uuid.safeParse(skillId).success) return fail("Unknown skill.");
  const { supabase } = await client();
  const ctx = await loadUserContext(supabase, new Date());
  const skill = ctx.skills.find((s) => s.id === skillId);
  if (!skill) return fail("Unknown skill.");

  if (status !== "active") {
    const pin = ctx.rackPins.find((p) => p.skill_id === skillId);
    if (pin) {
      if (new Date(pin.locked_until) > ctx.now) return fail("It is locked on the rack. Try again when the lock ends.");
      const del = await supabase.from("rack_pins").delete().eq("skill_id", skillId);
      if (del.error) return fail(del.error.message);
    }
  }

  const score = ctx.breakdowns.get(skillId)?.score ?? 0;
  const patch =
    status === "archived"
      ? { status, archived_at: new Date().toISOString(), final_score: Math.round(score * 100) / 100 }
      : { status, archived_at: null };
  const { error } = await supabase.from("skills").update(patch).eq("id", skillId);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const Onboarding = z.object({
  claims: z.array(uuid).max(200),
  metrics: z.array(z.object({ skillId: uuid, key: z.string(), value: z.number().nonnegative() })).max(20),
  rack: z.array(uuid).min(1).max(5),
  schedule: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        dayType: z.enum(["class_light", "class_heavy", "weekend", "break"]),
        trainingTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      }),
    )
    .max(7),
  chess: z.object({ platform: z.enum(["chess.com", "lichess"]).nullable(), username: z.string().trim().max(40) }),
  focusLine: z.string().trim().max(80),
});

export async function completeOnboarding(input: z.infer<typeof Onboarding>): Promise<ActionResult> {
  const parsed = Onboarding.safeParse(input);
  if (!parsed.success) return fail("Pick at least one rack skill and check your entries.");
  if (parsed.data.metrics.some((m) => !METRIC_BY_KEY.has(m.key))) return fail("Unknown baseline.");
  const { supabase } = await client();
  const profile = await loadProfile(supabase);
  const { error } = await supabase.rpc("complete_onboarding", { p_day: todayFor(profile, new Date()), p: parsed.data });
  if (error) return fail(error.message);
  await autoClaim(supabase, await loadUserContext(supabase, new Date()));
  refresh();
  return { ok: true };
}
