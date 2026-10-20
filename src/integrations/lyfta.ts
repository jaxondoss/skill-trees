import { z } from "zod";
import { dayKey } from "@/engine/time";
import type { IntegrationAdapter, IntegrationEvent } from "./types";

/**
 * Lyfta workouts (spec 13), read-only, from Lyfta's public API docs (my.lyfta.app/developers):
 *   GET https://my.lyfta.app/api/v1/workouts?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100&page=N
 *   Authorization: Bearer <key>. from/to are inclusive UTC days; limit is capped at 100.
 *   60 requests a minute, 5,000 a day. The key is LYFTA_API_KEY, a server env var.
 * Response: { total_pages, current_page, workouts: [{ id, title, body_weight, workout_perform_date,
 *   exercises: [{ excercise_name (Lyfta's spelling), exercise_type, sets: [{ weight, reps, is_completed }] }] }] }.
 * Weight and reps arrive as strings. Shapes are read defensively; anything missing is skipped, not an error.
 */
export const LYFTA_BASE = "https://my.lyfta.app/api/v1/workouts";
const LOOKBACK_DAYS = 30;
const MAX_PAGES = 5;
const KG_TO_LB = 2.20462;

const Config = z.object({ unit: z.enum(["lb", "kg"]).default("lb") });
export type LyftaConfig = z.infer<typeof Config>;

export type LyftaSet = { weight: number; reps: number; completed: boolean };
export type LyftaWorkout = { id: string; performedAt: string; bodyWeight: number | null; exercises: { name: string; sets: LyftaSet[] }[] };

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Normalizes one page of /api/v1/workouts. */
export function parseWorkouts(body: unknown): { workouts: LyftaWorkout[]; totalPages: number } {
  const root = obj(body);
  const list = arr(root?.workouts ?? root?.data);
  const workouts = list.flatMap((w): LyftaWorkout[] => {
    const o = obj(w);
    const performedAt = typeof o?.workout_perform_date === "string" ? o.workout_perform_date : null;
    if (!o || !performedAt) return [];
    return [
      {
        id: String(o.id ?? performedAt),
        performedAt,
        bodyWeight: num(o.body_weight),
        exercises: arr(o.exercises).map((e) => {
          const x = obj(e);
          return {
            name: String(x?.excercise_name ?? x?.exercise_name ?? ""),
            sets: arr(x?.sets).map((s) => {
              const y = obj(s);
              return { weight: num(y?.weight) ?? 0, reps: num(y?.reps) ?? 0, completed: y?.is_completed !== false && y?.is_completed !== 0 };
            }),
          };
        }),
      },
    ];
  });
  return { workouts, totalPages: Math.max(1, num(root?.total_pages) ?? 1) };
}

/** Which main lift an exercise name is, if any. Barbell versions only; variations do not count toward the 1RM ladder. */
export function liftKey(name: string): "bench_1rm" | "squat_1rm" | "deadlift_1rm" | null {
  const n = name.toLowerCase();
  if (/dumbbell|machine|smith|incline|decline|close.grip|pause/.test(n)) return null;
  if (/bench press/.test(n)) return "bench_1rm";
  if (/squat/.test(n) && !/front|split|goblet|hack|overhead|box|jump|sumo|bulgarian/.test(n)) return "squat_1rm";
  if (/deadlift/.test(n) && !/romanian|stiff|single|rdl|deficit|trap|hex/.test(n)) return "deadlift_1rm";
  return null;
}

/** The workout's day by the app's day boundary. A bare date is taken as is. */
export function workoutDay(performedAt: string, timeZone: string, rolloverHour: number): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(performedAt)) return performedAt;
  const at = new Date(performedAt.includes("T") || performedAt.includes("Z") ? performedAt : performedAt.replace(" ", "T") + "Z");
  return Number.isNaN(at.getTime()) ? performedAt.slice(0, 10) : dayKey(at, timeZone, rolloverHour);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const lyftaAdapter: IntegrationAdapter<LyftaConfig, { workouts: LyftaWorkout[] }> = {
  id: "lyfta",
  label: "Lyfta",
  feeds: "Strength: a logged workout completes today's goal; top sets update bench, squat and deadlift; bodyweight when you log it.",
  fallback: { label: "Enter top sets on the Strength page", href: "/s/strength" },
  available: true,
  needs: ["LYFTA_API_KEY in Vercel (Lyfta, Settings, API)"],
  envKey: "LYFTA_API_KEY",
  connect: (input) => Config.parse(input ?? {}),
  async sync(_config, secret, fetchImpl) {
    if (!secret) throw new Error("LYFTA_API_KEY is not set in Vercel.");
    const to = new Date();
    const from = new Date(to.getTime() - LOOKBACK_DAYS * 86_400_000);
    const workouts: LyftaWorkout[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${LYFTA_BASE}?from=${isoDay(from)}&to=${isoDay(to)}&limit=100&page=${page}`;
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${secret}`, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (res.status === 401 || res.status === 403) throw new Error("Lyfta rejected the API key. Generate a new one in Lyfta and update LYFTA_API_KEY.");
      if (res.status === 429) throw new Error("Lyfta is rate limiting requests. It retries on the next sync.");
      if (!res.ok) throw new Error(`Lyfta answered ${res.status}.`);
      const parsed = parseWorkouts(await res.json());
      workouts.push(...parsed.workouts);
      if (page >= parsed.totalPages) break;
    }
    return { workouts };
  },
  mapToEvents(raw, { config, timeZone = "America/Chicago", rolloverHour = 4 }) {
    const toLb = (v: number) => Math.round((config.unit === "kg" ? v * KG_TO_LB : v) * 10) / 10;
    const events: IntegrationEvent[] = [];
    const days = new Set<string>();
    const best = new Map<string, number>();
    const bodyweight = new Map<string, number>();
    for (const w of raw.workouts) {
      const day = workoutDay(w.performedAt, timeZone, rolloverHour);
      days.add(day);
      if (w.bodyWeight && w.bodyWeight > 0) bodyweight.set(day, toLb(w.bodyWeight));
      for (const e of w.exercises) {
        const key = liftKey(e.name);
        if (!key) continue;
        for (const s of e.sets) {
          if (!s.completed || s.reps < 1 || s.weight <= 0) continue;
          const id = `${key}|${day}`;
          best.set(id, Math.max(best.get(id) ?? 0, toLb(s.weight)));
        }
      }
    }
    for (const day of [...days].sort()) events.push({ kind: "goal_complete", skillSlug: "strength", tier: "standard", day });
    for (const [id, value] of best) {
      const [key, day] = id.split("|") as [string, string];
      events.push({ kind: "metric", skillSlug: "strength", key, value, day });
    }
    for (const [day, value] of bodyweight) events.push({ kind: "metric", skillSlug: "strength", key: "bodyweight_lb", value, day });
    return events;
  },
};
