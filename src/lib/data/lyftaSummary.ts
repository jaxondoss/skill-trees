import { LYFTA_BASE } from "@/integrations/lyfta";

/**
 * The strength hologram's Lyfta summary (window.ROOM_LYFTA in the prototype, room.lyfta in the app): this week and
 * last week per day, eight weeks of sessions, today's session, volume per muscle over 7 and 28 days, and lifts done
 * against an assumed weekly plan. Pure apart from fetchLyftaWorkouts. Used by scripts/room-lyfta-snapshot.mjs and
 * src/lib/data/room.ts. Mapping as in the approved gym mockup (holo-gym raw/build_data.py):
 *   volume per set: weight x reps; full-bodyweight moves add body weight; two-dumbbell moves count both dumbbells
 *   (matches Lyfta's total_volume). Muscle split: the body part in exercise_image's file name, refined by the name.
 * Assumptions (labelled in the output): Lyfta timestamps are UTC and the day is America/Los_Angeles; 4 planned lifts
 * a week (Lyfta has no schedule).
 */
export const LYFTA_TZ = "America/Los_Angeles";
export const PLANNED_LIFTS = 4;
export const MUSCLES = ["chest", "shoulders", "biceps", "triceps", "forearms", "abs", "obliques", "upperBack", "lowerBack", "glutes", "quads", "hamstrings", "calves"] as const;
export type Muscle = (typeof MUSCLES)[number];

type RawSet = { weight?: unknown; reps?: unknown };
type RawExercise = { excercise_name?: unknown; exercise_name?: unknown; exercise_type?: unknown; exercise_image?: unknown; sets?: unknown };
export type RawWorkout = {
  title?: unknown;
  workout_perform_date?: unknown;
  workout_duration?: unknown;
  total_volume?: unknown;
  body_weight?: unknown;
  weight_unit?: unknown;
  exercises?: unknown;
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};
const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** ISO day (YYYY-MM-DD) and HH:MM of an instant in a time zone. */
function localParts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowIndex = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

/** "H:MM:SS" -> minutes. */
export function durationMin(s: unknown) {
  const p = String(s ?? "").split(":").map((x) => Number.parseInt(x, 10) || 0);
  if (p.length !== 3) return 0;
  return Math.round(p[0]! * 60 + p[1]! + p[2]! / 60);
}

export function setVolume(e: RawExercise, s: RawSet, bodyWeight: number) {
  const w = num(s.weight), r = num(s.reps), t = String(e.exercise_type ?? "");
  if (t === "full_bodyweight") return (bodyWeight + w) * r;
  if (t === "db_2_simultaneous") return 2 * w * r;
  return w * r;
}

/** The body part Lyfta encodes in the exercise image's file name (e.g. ..._Chest_small.png), lower case. */
export function bodyPart(e: RawExercise) {
  const m = /_([A-Za-z-]+)_small\.png$/.exec(String(e.exercise_image ?? ""));
  const p = (m ? m[1]! : "Other").split("-").filter((x) => !["FIX", "AFIX", "SFIX"].includes(x));
  return p.join("-").toLowerCase();
}

/** How an exercise's volume splits across muscles (fractions sum to 1, or {} when unknown). */
export function muscleSplit(e: RawExercise): Partial<Record<Muscle, number>> {
  const p = bodyPart(e);
  const n = String(e.excercise_name ?? e.exercise_name ?? "").toLowerCase();
  if (p === "upper-arms") {
    if (n.includes("dip")) return { triceps: 0.7, chest: 0.2, shoulders: 0.1 };
    if (n.includes("hammer")) return { forearms: 0.5, biceps: 0.5 };
    if (n.includes("curl")) return { biceps: 0.85, forearms: 0.15 };
    return { triceps: 1 };
  }
  if (p === "triceps") return { triceps: 1 };
  if (p === "biceps") return { biceps: 0.85, forearms: 0.15 };
  if (p === "forearms") return n.includes("curl") ? { forearms: 0.5, biceps: 0.5 } : { forearms: 1 };
  if (p === "chest") return n.includes("fly") ? { chest: 1 } : { chest: 0.75, shoulders: 0.15, triceps: 0.1 };
  if (p === "shoulders" || p === "shoulder") {
    if (n.includes("face pull") || n.includes("rear")) return { shoulders: 0.65, upperBack: 0.35 };
    if (n.includes("press")) return { shoulders: 0.8, triceps: 0.2 };
    return { shoulders: 1 };
  }
  if (p === "back") {
    if (n.includes("pull-up") || n.includes("pulldown") || n.includes("pull up")) return { upperBack: 0.85, biceps: 0.15 };
    if (n.includes("row")) return { upperBack: 0.7, lowerBack: 0.15, biceps: 0.15 };
    if (n.includes("deadlift") || n.includes("extension")) return { lowerBack: 0.6, glutes: 0.2, hamstrings: 0.2 };
    return { upperBack: 0.8, lowerBack: 0.2 };
  }
  if (p === "waist") return { abs: 0.7, obliques: 0.3 };
  if (p === "thighs") {
    if (n.includes("leg curl")) return { hamstrings: 1 };
    if (n.includes("extension")) return { quads: 1 };
    return { quads: 0.55, glutes: 0.25, hamstrings: 0.2 };
  }
  if (p === "hips") return { glutes: 1 };
  if (p === "calves") return { calves: 1 };
  return {};
}

export type LyftaSummary = ReturnType<typeof summarizeLyfta>;

/** Raw /api/v1/workouts rows -> the hologram's summary. today: the local ISO day the week ends on. */
export function summarizeLyfta(workouts: RawWorkout[], opts: { today: string; timeZone?: string; planned?: number; fetched?: string }) {
  const tz = opts.timeZone ?? LYFTA_TZ;
  const planned = opts.planned ?? PLANNED_LIFTS;
  const today = opts.today;
  const rows = workouts.flatMap((w) => {
    const at = String(w.workout_perform_date ?? "");
    if (!at) return [];
    const inst = new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
    if (Number.isNaN(inst.getTime())) return [];
    const { day, time } = localParts(inst, tz);
    const bw = num(w.body_weight);
    const exercises = arr<RawExercise>(w.exercises).map((e) => {
      const sets = arr<RawSet>(e.sets);
      return {
        name: String(e.excercise_name ?? e.exercise_name ?? ""),
        part: bodyPart(e),
        sets: sets.length,
        reps: sets.reduce((a, s) => a + Math.trunc(num(s.reps)), 0),
        volume: Math.round(sets.reduce((a, s) => a + setVolume(e, s, bw), 0)),
        split: muscleSplit(e),
      };
    });
    const calc = exercises.reduce((a, x) => a + x.volume, 0);
    return [
      {
        date: day,
        time,
        title: String(w.title ?? ""),
        minutes: durationMin(w.workout_duration),
        volume: w.total_volume != null ? Math.round(num(w.total_volume)) : calc,
        cardio: exercises.length > 0 && exercises.every((x) => x.part === "cardio"),
        exercises,
      },
    ];
  });
  const agg = (days: string[]) => {
    const set = new Set(days);
    const r = rows.filter((x) => set.has(x.date));
    return { workouts: r.length, minutes: r.reduce((a, x) => a + x.minutes, 0), volume: r.reduce((a, x) => a + x.volume, 0) };
  };
  const monday = addDays(today, -dowIndex(today));
  const week = DOW.map((dow, i) => {
    const date = addDays(monday, i);
    return { date, dow, future: date > today, ...agg([date]) };
  });
  const prevWeek = DOW.map((dow, i) => {
    const date = addDays(monday, i - 7);
    return { date, dow, ...agg([date]) };
  });
  const weeks8 = Array.from({ length: 8 }, (_, j) => {
    const k = 7 - j;
    const m = addDays(monday, -7 * k);
    const days = Array.from({ length: 7 }, (_, i) => addDays(m, i));
    const set = new Set(days);
    return { start: m, partial: k === 0, ...agg(days), lifts: rows.filter((x) => set.has(x.date) && !x.cardio).length };
  });
  const muscles = (n: number) => {
    const days = new Set(Array.from({ length: n }, (_, i) => addDays(today, -i)));
    const v = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
    for (const x of rows) if (days.has(x.date)) for (const e of x.exercises) for (const [k, f] of Object.entries(e.split)) v[k as Muscle] += e.volume * (f ?? 0);
    for (const m of MUSCLES) v[m] = Math.round(v[m]);
    return { from: addDays(today, -(n - 1)), to: today, volume: v };
  };
  const done = rows.filter((x) => !x.cardio && x.date >= monday && x.date <= today).length;
  const todays = rows.filter((x) => x.date === today);
  const last = [...rows].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).at(-1) ?? null;
  return {
    source: "Lyfta API (my.lyfta.app /api/v1/workouts)",
    asOf: today,
    fetched: opts.fetched ?? null,
    timezone: `${tz} (assumed; Lyfta timestamps are UTC)`,
    weightUnit: String(workouts[0]?.weight_unit ?? "lb"),
    bodyWeight: workouts[0] ? num(workouts[0].body_weight) || null : null,
    weekStart: monday,
    week,
    prevWeek,
    weeks8,
    today: { date: today, ...agg([today]), sessions: todays },
    lastSession: last ? { date: last.date, time: last.time, title: last.title, minutes: last.minutes, volume: last.volume } : null,
    muscles7d: muscles(7),
    muscles28d: muscles(28),
    schedule: { plannedPerWeek: planned, assumed: true, doneThisWeek: done, score: Math.round((done / planned) * 1000) / 1000 },
    volumeRule: "per set: weight x reps; bodyweight moves add body weight; two-dumbbell moves count both dumbbells (matches Lyfta total_volume)",
  };
}

/** Today's ISO day in a time zone. */
export function localToday(timeZone = LYFTA_TZ, now = new Date()) {
  return localParts(now, timeZone).day;
}

/**
 * The raw workouts of the last `days` days (all pages, at most 5). With key null no Authorization header is sent
 * (the snapshot script runs behind a proxy that adds it).
 */
export async function fetchLyftaWorkouts(key: string | null, fetchImpl: typeof fetch = fetch, days = 60): Promise<RawWorkout[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const out: RawWorkout[] = [];
  for (let page = 1; page <= 5; page++) {
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await fetchImpl(`${LYFTA_BASE}?from=${iso(from)}&to=${iso(to)}&limit=100&page=${page}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Lyfta answered ${res.status}.`);
    const body = (await res.json()) as { workouts?: RawWorkout[]; total_pages?: unknown };
    out.push(...arr<RawWorkout>(body.workouts));
    if (page >= Math.max(1, num(body.total_pages))) break;
  }
  return out;
}
