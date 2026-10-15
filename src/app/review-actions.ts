"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { applyDifficulty } from "@/engine/review";
import type { Tier } from "@/engine/types";
import { claudeAvailable, writeDebrief } from "@/lib/claude";
import { loadUserContext } from "@/lib/data/context";
import { buildWeek, DROPSHIP_KEYS, monthStartFor, type Decision } from "@/lib/data/reviews";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";
import type { ActionData } from "./tracker-actions";

const fail = (error: string): ActionResult => ({ ok: false, error });
const uuid = z.string().uuid();

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return { supabase, uid };
}

const Weekly = z.object({
  obstacle: z.string().trim().max(1000),
  focusLine: z.string().trim().max(80),
  decisions: z.array(z.object({ nonNegotiableId: uuid, kind: z.enum(["level_up", "ease"]), accepted: z.boolean() })).max(40),
  dropship: z.record(z.enum(DROPSHIP_KEYS), z.number().min(0).max(10_000_000).nullable()).optional(),
});

/**
 * Saves the week: the answer, next week's focus line (shown under the banner), difficulty
 * decisions (accepted ones change the default tier once), and the store's weekly numbers.
 */
export async function saveWeeklyReview(input: z.infer<typeof Weekly>): Promise<ActionResult> {
  const p = Weekly.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the review.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const ctx = await loadUserContext(supabase, new Date());
  const week = await buildWeek(supabase, ctx);

  // Accepted decisions apply once: skip any already accepted in an earlier save of this week.
  const { data: prior } = await supabase.from("weekly_reviews").select("decisions").eq("week_start", week.weekStart).maybeSingle();
  const already = new Set(((prior as { decisions: Decision[] } | null)?.decisions ?? []).filter((d) => d.accepted).map((d) => d.nonNegotiableId));
  for (const d of p.data.decisions) {
    if (!d.accepted || already.has(d.nonNegotiableId)) continue;
    const nn = ctx.nonNegotiables.find((n) => n.id === d.nonNegotiableId);
    if (!nn) continue;
    const next = applyDifficulty(nn.default_tier as Tier, d.kind);
    const res = await supabase.from("non_negotiables").update({ default_tier: next }).eq("id", nn.id);
    if (res.error) return fail(res.error.message);
  }
  // A decision accepted earlier stays accepted.
  const decisions = p.data.decisions.map((d) => (already.has(d.nonNegotiableId) ? { ...d, accepted: true } : d));

  const row = {
    user_id: uid,
    week_start: week.weekStart,
    completion_pct: week.completion.avg === null ? null : Math.round(week.completion.avg * 100) / 100,
    kept_days: week.completion.kept,
    obstacle: p.data.obstacle || null,
    focus_line: p.data.focusLine || null,
    decisions,
  };
  const up = await supabase.from("weekly_reviews").upsert(row, { onConflict: "user_id,week_start" });
  if (up.error) return fail(up.error.message);

  const prof = await supabase.from("profiles").update({ focus_line: p.data.focusLine || null }).eq("user_id", uid);
  if (prof.error) return fail(prof.error.message);

  if (p.data.dropship) {
    const skill = ctx.skills.find((s) => s.slug === "dropshipping");
    const del = await supabase.from("metrics").delete().in("key", [...DROPSHIP_KEYS]).eq("day", week.sunday).eq("source", "weekly_review");
    if (del.error) return fail(del.error.message);
    const rows = Object.entries(p.data.dropship)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, value]) => ({ user_id: uid, skill_id: skill?.id ?? null, key, value, day: week.sunday, source: "weekly_review" }));
    if (rows.length) {
      const ins = await supabase.from("metrics").insert(rows);
      if (ins.error) return fail(ins.error.message);
    }
  }
  refresh();
  return { ok: true };
}

/** Optional Claude debrief from the saved week's facts. Saved with the review. */
export async function requestDebrief(): Promise<ActionData<string>> {
  if (!claudeAvailable()) return { ok: false, error: "Claude is not connected." };
  const { supabase, uid } = await session();
  if (!uid) return { ok: false, error: "Sign in again." };
  const week = await buildWeek(supabase, await loadUserContext(supabase, new Date()));
  if (!week.saved) return { ok: false, error: "Save the review first." };
  try {
    const text = await writeDebrief(week.facts);
    const res = await supabase.from("weekly_reviews").update({ debrief: text }).eq("week_start", week.weekStart);
    if (res.error) return { ok: false, error: res.error.message };
    refresh();
    return { ok: true, data: text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not write the debrief." };
  }
}

const Monthly = z.object({
  calibrations: z.record(uuid, z.enum(["too_high", "right", "too_low"])),
  notes: z.string().trim().max(1000),
});

export async function saveMonthlyReview(input: z.infer<typeof Monthly>): Promise<ActionResult> {
  const p = Monthly.safeParse(input);
  if (!p.success) return fail("Check the review.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const month = await monthStartFor(supabase);
  const { error } = await supabase
    .from("monthly_reviews")
    .upsert({ user_id: uid, month, calibrations: p.data.calibrations, notes: p.data.notes || null }, { onConflict: "user_id,month" });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const NewSkill = z.object({
  name: z.string().trim().min(2).max(40),
  categoryId: uuid,
  identity: z.string().trim().max(200),
});

/** A new skill starts with a starter daily goal and no milestones; its page asks for milestones until they total 100. */
export async function addSkill(input: z.infer<typeof NewSkill>): Promise<ActionData<string>> {
  const p = NewSkill.safeParse(input);
  if (!p.success) return { ok: false, error: "Give it a name and a category." };
  const { supabase, uid } = await session();
  if (!uid) return { ok: false, error: "Sign in again." };
  const base =
    p.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "skill";
  const { data: taken } = await supabase.from("skills").select("slug").like("slug", `${base}%`);
  const used = new Set(((taken ?? []) as { slug: string }[]).map((r) => r.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  const { data: last } = await supabase.from("skills").select("sort").eq("category_id", p.data.categoryId).order("sort", { ascending: false }).limit(1);
  const sort = (((last ?? [])[0] as { sort: number } | undefined)?.sort ?? 0) + 1;
  const { data: created, error } = await supabase
    .from("skills")
    .insert({ user_id: uid, category_id: p.data.categoryId, slug, name: p.data.name, identity: p.data.identity, sort, priority_weight: 2, status: "active" })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not add the skill." };
  // A starter daily goal so the engine can plan it; edit the tiers on the skill page.
  const nn = await supabase.from("non_negotiables").insert({
    user_id: uid,
    skill_id: (created as { id: string }).id,
    name: p.data.name,
    floor_text: `10 min of ${p.data.name}`,
    standard_text: `30 min of ${p.data.name}`,
    stretch_text: `45 min of ${p.data.name}`,
    floor_min: 10,
    standard_min: 30,
    stretch_min: 45,
  });
  if (nn.error) return { ok: false, error: nn.error.message };
  refresh();
  return { ok: true, data: slug };
}
