import "server-only";
import { METRIC_BY_KEY } from "@/engine/metrics";
import { tipTier } from "@/engine/scoring";
import { addDays } from "@/engine/time";
import { createClient } from "@/lib/supabase/server";
import type { UserContext } from "./context";
import { loadDashboardContext } from "./dashboard";
import { loadStatueLevel } from "./statue";
import type { MetricRow } from "./rows";

/**
 * window.ROOM_DATA for the v3 room: the same shape as docs/redesign/room-prototype/data.js
 * (scripts/room-proto-data.ts), built from the user's real rows. `live: true` tells the room UI that
 * every change goes to the server.
 */

/** What the room logs for each skill's panel ("Log a number"). Skills without one link to their page. */
export const ROOM_METRIC: Record<string, { key: string; unit: string }> = {
  "ai-building": { key: "shipped_products", unit: "products" },
  dropshipping: { key: "revenue_week_usd", unit: "$ this week" },
  academics: { key: "semester_gpa", unit: "GPA" },
  reading: { key: "book_pages", unit: "pages" },
  chess: { key: "chess_rating", unit: "rating" },
  visualization: { key: "vividness", unit: "of 5" },
  strength: { key: "bench_1rm", unit: "lb bench" },
  running: { key: "run_mi", unit: "mi" },
  triathlon: { key: "swim_min", unit: "swim min" },
  "gut-health": { key: "plants_best_week", unit: "plants" },
};

/** The metric a relic linked to a skill tracks against its target. */
export const RELIC_METRIC: Record<string, string> = {
  "ai-building": "shipped_products",
  dropshipping: "revenue_month_usd",
  academics: "semester_gpa",
  reading: "books_finished",
  chess: "chess_rating",
  strength: "bench_1rm",
  running: "long_run_mi",
  triathlon: "bike_ride_mi",
  "gut-health": "plants_best_week",
};

export type RelicRow = {
  id: string;
  slot: "left" | "window" | "right";
  catalog_id: string | null;
  title: string;
  skill_slug: string | null;
  metric_key: string | null;
  milestone_id: string | null;
  target: number | null;
  steps: { text: string; done: boolean }[];
  deadline: string | null;
  status: "active" | "achieved" | "abandoned";
  achieved_at: string | null;
  created_at: string;
};

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_TYPE: Record<string, string> = { class_light: "CLASS LIGHT", class_heavy: "CLASS HEAVY", weekend: "WEEKEND", break: "BREAK" };
const short = (day: string) => `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

/** A relic's progress, 0..1: from its metric against the target, its milestone, or its steps. */
export function relicProgress(r: Pick<RelicRow, "metric_key" | "target" | "milestone_id" | "steps" | "created_at" | "status">, metrics: Pick<MetricRow, "key" | "value" | "recorded_at">[], claimed: Set<string>): number {
  if (r.status === "achieved") return 1;
  if (r.milestone_id) return claimed.has(r.milestone_id) ? 1 : 0;
  if (r.metric_key && r.target && r.target > 0) {
    const def = METRIC_BY_KEY.get(r.metric_key);
    const rows = metrics.filter((m) => m.key === r.metric_key);
    if (!rows.length) return 0;
    const vals = rows.map((m) => m.value);
    let v: number;
    if (def?.agg === "sum") v = rows.filter((m) => m.recorded_at >= r.created_at).reduce((a, m) => a + m.value, 0);
    else if (def?.agg === "max") v = Math.max(...vals);
    else if (def?.agg === "min") return Math.min(1, r.target / Math.max(1e-9, Math.min(...vals)));
    else v = vals[vals.length - 1]!;
    return Math.max(0, Math.min(1, v / r.target));
  }
  if (r.steps.length) return r.steps.filter((s) => s.done).length / r.steps.length;
  return 0;
}

function courses(ctx: UserContext) {
  const acad = ctx.skills.find((s) => s.slug === "academics");
  const list = (acad?.config?.courses as unknown[] | undefined) ?? [];
  const grades = ctx.metrics.filter((m) => m.key === "course_grade");
  const letter = (p: number) => (p >= 93 ? "A" : p >= 90 ? "A-" : p >= 87 ? "B+" : p >= 83 ? "B" : p >= 80 ? "B-" : p >= 77 ? "C+" : p >= 70 ? "C" : "D");
  return list
    .map((c) => (typeof c === "string" ? c : typeof c === "object" && c && "code" in c ? String((c as { code: unknown }).code) : ""))
    .filter(Boolean)
    .map((raw) => {
      const m = /^([A-Z]{3,4}\s?\d{4})\s*(.*)$/.exec(raw);
      const code = m ? m[1]! : raw;
      const g = grades.filter((x) => String(x.meta?.course ?? "").startsWith(code)).at(-1);
      return { code, name: m ? m[2]!.replace(/\s*\(.*\)$/, "") : "", grade: g ? letter(g.value) : null, due: [] as string[] };
    });
}

export async function loadRoomData() {
  const { data, ctx } = await loadDashboardContext();
  const supabase = await createClient();
  const relicRes = await supabase
    .from("relics")
    .select("id, slot, catalog_id, title, skill_slug, metric_key, milestone_id, target, steps, deadline, status, achieved_at, created_at")
    .neq("status", "abandoned")
    .order("created_at");
  // Before migration 0011 runs the table is missing: the room still loads, with empty mounts.
  const relicRows = (relicRes.error ? [] : (relicRes.data ?? [])) as RelicRow[];

  const catSlug = new Map(ctx.categories.map((c) => [c.id, c.slug]));
  const skillSlug = new Map(ctx.skills.map((s) => [s.id, s.slug]));
  const claimed = new Set(ctx.milestones.filter((m) => m.claimed_at).map((m) => m.id));
  const series = (key: string) => ctx.metrics.filter((m) => m.key === key).slice(-14).map((m) => m.value);

  const skills = data.skills.map((s) => {
    const row = ctx.skills.find((r) => r.id === s.id);
    const log = ROOM_METRIC[s.slug];
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      category: catSlug.get(s.categoryId) ?? "",
      status: s.status,
      identity: row?.identity ?? "",
      score: Math.round(s.score * 10) / 10,
      display: s.display,
      level: Math.round(s.level),
      consistency: Math.round(s.consistency),
      levelName: tipTier(s.score),
      neglected: s.neglected,
      pinned: s.pinned,
      logKey: log?.key ?? null,
      logUnit: log?.unit ?? null,
      series: log ? series(log.key) : [],
      goals: ctx.nonNegotiables
        .filter((n) => n.skill_id === s.id)
        .map((n) => ({
          name: n.name,
          floor: n.floor_text,
          standard: n.standard_text,
          stretch: n.stretch_text,
          minutes: { floor: n.floor_min, standard: n.standard_min, stretch: n.stretch_min },
          intention: n.intention,
        })),
      steps: ctx.milestones.filter((m) => m.skill_id === s.id).map((m) => ({ title: m.title, points: m.points, claimed: m.claimed_at !== null })),
    };
  });

  const goals = data.goals.map((g) => ({
    id: g.id,
    skill: skillSlug.get(g.skillId) ?? "",
    kind: g.kind,
    tier: g.tier,
    title: g.title,
    text: g.text,
    estMin: g.estMin,
    result: g.resultTier,
    nmt: /miss twice/i.test(`${g.note ?? ""} ${g.reason ?? ""}`),
  }));

  const slots: Record<"left" | "window" | "right", unknown> = { left: null, window: null, right: null };
  const trophies: unknown[] = [];
  for (const r of relicRows) {
    const progress = relicProgress({ ...r, target: r.target === null ? null : Number(r.target) }, ctx.metrics, claimed);
    const unit = r.metric_key ? (METRIC_BY_KEY.get(r.metric_key)?.unit ?? "") : "";
    const view = {
      id: r.id,
      title: r.title,
      icon: r.catalog_id ?? "anvil",
      skill: r.skill_slug,
      target: r.target !== null ? `${Number(r.target).toLocaleString("en-US")}${unit ? ` ${unit}` : ""}` : null,
      steps: r.steps.length ? r.steps : null,
      deadline: r.deadline,
      progress,
    };
    if (r.status === "achieved") trophies.push({ title: r.title, icon: view.icon, day: (r.achieved_at ?? "").slice(0, 10) });
    else slots[r.slot] = view;
  }

  const wd = new Date(`${ctx.today}T12:00:00Z`);
  const dueSoon = ctx.assignments
    .filter((a) => !a.submitted)
    .map((a) => ({ name: a.course ? `${a.course}: ${a.name}` : a.name, hours: Math.round((new Date(a.due_at).getTime() - ctx.now.getTime()) / 3_600_000) }))
    .filter((a) => a.hours >= 0 && a.hours <= 7 * 24);
  const todayP = data.todayP === null ? 0 : Math.round(data.todayP);
  const statue = await loadStatueLevel(supabase, data.overall.score);

  return {
    live: true,
    label: "",
    today: ctx.today,
    weekdayLabel: `${WD[wd.getUTCDay()]} ${wd.getUTCDate()} ${MON[wd.getUTCMonth()]}`,
    dayType: DAY_TYPE[ctx.resolved.dayType] ?? "",
    focusLine: data.focusLine ?? "",
    overall: {
      score: Math.round(data.overall.score * 10) / 10,
      display: data.overall.display,
      tier: data.overall.tier,
      numeral: data.overall.tierNumeral,
      name: data.overall.tierName,
      level: statue.level,
    },
    categories: data.categories.map((c) => ({ slug: c.slug, name: c.name, score: c.score === null ? null : Math.round(c.score * 10) / 10 })),
    skills,
    goals,
    todayP,
    swapUsed: data.plan.swapUsed,
    streak: { current: data.streak.current, best: data.streak.best },
    calendar: data.calendar.filter((c) => c.day >= addDays(ctx.today, -35)).map((c) => ({ day: c.day, p: Math.round(c.p) })),
    review: data.review,
    dueSoon,
    courses: courses(ctx),
    bodyweight: ctx.metrics
      .filter((m) => m.key === "bodyweight_lb")
      .slice(-4)
      .map((m) => ({ day: short(m.day), lb: m.value })),
    relics: { slots, trophies },
    soundOn: data.soundOn,
  };
}

export type RoomData = Awaited<ReturnType<typeof loadRoomData>>;
