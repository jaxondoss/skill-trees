"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { RELIC_METRIC } from "@/lib/data/room";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

/** Relics (room v3): long goals on the three mounts. Progress is computed on load (src/lib/data/room.ts). */

type ActionData<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

const Slot = z.enum(["left", "window", "right"]);
const Steps = z.array(z.object({ text: z.string().trim().min(1).max(80), done: z.boolean() })).max(12);
const NewRelic = z.object({
  slot: Slot,
  catalogId: z.string().trim().max(40).nullable(),
  title: z.string().trim().min(1).max(60),
  skillSlug: z.string().regex(/^[a-z0-9-]{1,40}$/).nullable(),
  /** A number to hit (with the linked skill's metric), or null. */
  target: z.number().positive().max(1e9).nullable(),
  steps: Steps,
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return { supabase, uid };
}

export async function createRelic(input: z.infer<typeof NewRelic>): Promise<ActionData<{ id: string }>> {
  const p = NewRelic.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the relic.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const r = p.data;
  const metric = r.skillSlug && r.target !== null ? (RELIC_METRIC[r.skillSlug] ?? null) : null;
  const { data, error } = await supabase
    .from("relics")
    .insert({
      user_id: uid,
      slot: r.slot,
      catalog_id: r.catalogId,
      title: r.title,
      skill_slug: r.skillSlug,
      metric_key: metric,
      target: r.target,
      steps: r.steps,
      deadline: r.deadline,
    })
    .select("id")
    .single();
  if (error) return fail(error.code === "23505" ? "That mount already holds a relic." : error.message);
  refresh();
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateRelicSteps(id: string, steps: z.infer<typeof Steps>): Promise<ActionResult> {
  const p = Steps.safeParse(steps);
  if (!z.string().uuid().safeParse(id).success || !p.success) return fail("Unknown relic.");
  const { supabase } = await session();
  const { error } = await supabase.from("relics").update({ steps: p.data }).eq("id", id).eq("status", "active");
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

async function close(id: string, status: "achieved" | "abandoned"): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail("Unknown relic.");
  const { supabase } = await session();
  const { error } = await supabase
    .from("relics")
    .update({ status, achieved_at: status === "achieved" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("status", "active");
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function achieveRelic(id: string): Promise<ActionResult> {
  return close(id, "achieved");
}

export async function abandonRelic(id: string): Promise<ActionResult> {
  return close(id, "abandoned");
}

export async function saveFocusLine(line: string): Promise<ActionResult> {
  const v = z.string().trim().max(60).safeParse(line);
  if (!v.success) return fail("Keep it under 60 characters.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase.from("profiles").update({ focus_line: v.data || null }).eq("user_id", uid);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}
