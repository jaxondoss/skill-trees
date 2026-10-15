"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { loadProfile, todayFor } from "@/lib/data/context";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const fail = (error: string): ActionResult => ({ ok: false, error });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return { supabase, uid };
}

async function done(error: { message: string } | null): Promise<ActionResult> {
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const Profile = z.object({
  rolloverHour: z.number().int().min(0).max(12),
  dailyBudgetMin: z.number().int().min(15).max(600),
  soundOn: z.boolean(),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
});

export async function updateProfile(input: z.infer<typeof Profile>): Promise<ActionResult> {
  const p = Profile.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the values.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase
    .from("profiles")
    .update({ rollover_hour: p.data.rolloverHour, daily_budget_min: p.data.dailyBudgetMin, sound_on: p.data.soundOn, timezone: p.data.timezone })
    .eq("user_id", uid);
  return done(error);
}

const ScheduleDay = z.object({
  weekday: z.number().int().min(0).max(6),
  dayType: z.enum(["class_light", "class_heavy", "weekend", "break"]),
  trainingTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
});

export async function updateScheduleDay(templateId: string, input: z.infer<typeof ScheduleDay>): Promise<ActionResult> {
  const p = ScheduleDay.safeParse(input);
  if (!p.success || !z.string().uuid().safeParse(templateId).success) return fail("Check the day.");
  const { supabase } = await session();
  const { error } = await supabase
    .from("schedule_days")
    .update({ day_type: p.data.dayType, training_time: p.data.trainingTime })
    .eq("template_id", templateId)
    .eq("weekday", p.data.weekday);
  return done(error);
}

const Semester = z.object({ name: z.string().trim().min(2).max(40), startsOn: day, endsOn: day }).refine((s) => s.endsOn >= s.startsOn, "The end comes after the start.");

/** A new semester starts from a copy of the current week, then gets edited (spec 8: Spring 2027 will differ). */
export async function startSemester(input: z.infer<typeof Semester>): Promise<ActionResult> {
  const p = Semester.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the dates.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const { data: current } = await supabase.from("schedule_templates").select("id").eq("is_active", true).maybeSingle();
  const { data: days } = current
    ? await supabase.from("schedule_days").select("weekday, day_type, classes, training_time, notes").eq("template_id", (current as { id: string }).id)
    : { data: [] };
  await supabase.from("schedule_templates").update({ is_active: false }).eq("is_active", true);
  const { data: created, error } = await supabase
    .from("schedule_templates")
    .insert({ user_id: uid, name: p.data.name, starts_on: p.data.startsOn, ends_on: p.data.endsOn, is_active: true })
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Could not create the semester.");
  const rows = ((days ?? []) as Record<string, unknown>[]).map((d) => ({ ...d, user_id: uid, template_id: (created as { id: string }).id, classes: [] }));
  if (rows.length) {
    const ins = await supabase.from("schedule_days").insert(rows);
    if (ins.error) return fail(ins.error.message);
  }
  return done(null);
}

const Override = z
  .object({ kind: z.enum(["exam_week", "race_week", "sick", "travel"]), startsOn: day, endsOn: day, note: z.string().trim().max(100).optional() })
  .refine((o) => o.endsOn >= o.startsOn, "The end comes after the start.");

export async function addOverride(input: z.infer<typeof Override>): Promise<ActionResult> {
  const p = Override.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the dates.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const { error } = await supabase
    .from("day_overrides")
    .insert({ user_id: uid, kind: p.data.kind, starts_on: p.data.startsOn, ends_on: p.data.endsOn, note: p.data.note || null });
  return done(error);
}

export async function deleteOverride(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail("Unknown override.");
  const { supabase } = await session();
  const { error } = await supabase.from("day_overrides").delete().eq("id", id);
  return done(error);
}

const KeyDate = z.object({
  label: z.string().trim().min(2).max(60),
  kind: z.enum(["race", "exam", "other"]),
  date: day.nullable(),
  tentative: z.boolean(),
  goal: z.string().trim().max(80).nullable(),
});

/** Races and exams (race dates drive Race Build and Race Week). */
export async function saveKeyDate(id: string | null, input: z.infer<typeof KeyDate>): Promise<ActionResult> {
  const p = KeyDate.safeParse(input);
  if (!p.success) return fail("Give it a name.");
  const { supabase, uid } = await session();
  if (!uid) return fail("Sign in again.");
  const row = { label: p.data.label, kind: p.data.kind, date: p.data.date, tentative: p.data.tentative, goal: p.data.goal };
  const { error } = id ? await supabase.from("key_dates").update(row).eq("id", id) : await supabase.from("key_dates").insert({ ...row, user_id: uid });
  return done(error);
}

export async function deleteKeyDate(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail("Unknown date.");
  const { supabase } = await session();
  const { error } = await supabase.from("key_dates").delete().eq("id", id);
  return done(error);
}

/**
 * After changing overrides, budget, or schedule: rebuild today's plan, but only while nothing
 * has been logged on it. Logged work is never thrown away.
 */
export async function rebuildToday(): Promise<ActionResult> {
  const { supabase } = await session();
  const profile = await loadProfile(supabase);
  const today = todayFor(profile, new Date());
  const { data } = await supabase.from("daily_plans").select("id, plan_goals(result_tier)").eq("day", today).maybeSingle();
  const plan = data as { id: string; plan_goals: { result_tier: string | null }[] } | null;
  if (!plan) return { ok: true };
  if (plan.plan_goals.some((g) => g.result_tier)) return fail("Today already has logged goals, so it stays as is. Changes apply from tomorrow.");
  const { error } = await supabase.from("daily_plans").delete().eq("id", plan.id);
  return done(error);
}
