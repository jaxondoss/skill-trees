import "server-only";
import { formatMetric, METRIC_BY_KEY } from "@/engine/metrics";
import { addDays } from "@/engine/time";
import { nights } from "@/engine/trackers";
import type { Tier } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import { sleepSettings } from "./claims";
import { loadDashboardContext, type DashboardData } from "./dashboard";

/** The board (spec v2 r2, 3 and 4): the dashboard plus schedule, due soon, numbers, trend, journal, activity. */

export type SkillTileInfo = {
  goals: number;
  steps: number;
  stepsDone: number;
  /** Today's goal for this skill, if planned. */
  today: { title: string; result: Tier | null; tier: Tier } | null;
  /** First goal, for the status line when nothing is planned today. */
  firstGoal: { name: string; days: number[] } | null;
};
export type NumberTile = {
  key: string;
  label: string;
  unit: string;
  category: string;
  skillId: string | null;
  skillSlug: string;
  /** Metric key the tile logs into; null when the tile links to the skill page instead. */
  logKey: string | null;
  value: number | null;
  display: string | null;
  series: number[];
};
export type ScheduleItem = { time: string; end: string | null; title: string; sub: string; category: string; now: boolean };
export type DueItem = { id: string; name: string; course: string | null; hours: number };
export type JournalEntry = { id: string; body: string; mood: string | null; when: string };
export type ActivityItem = { id: string; category: string; what: string; kind: "Goal" | "Number" | "Step" | "Journal"; when: string; at: string; skillSlug: string | null };

export type BoardData = DashboardData & {
  /** category id -> slug */
  catSlug: Record<string, string>;
  skillInfo: Record<string, SkillTileInfo>;
  numbers: NumberTile[];
  schedule: ScheduleItem[];
  due: DueItem[];
  trend: { day: string; score: number }[];
  journal: JournalEntry[];
  activity: ActivityItem[];
  dateLabel: string;
  dayType: string;
};

const TIER_LABEL: Record<Tier, string> = { floor: "Floor", standard: "Standard", stretch: "Stretch" };
const DAY_TYPE: Record<string, string> = { class_light: "Light class day", class_heavy: "Heavy class day", weekend: "Weekend", break: "Break" };

export async function loadBoard(): Promise<BoardData> {
  const { data, ctx } = await loadDashboardContext();
  const supabase = await createClient();
  const tz = ctx.profile.timezone;
  const weekday = new Date(`${ctx.today}T12:00:00Z`).getUTCDay();

  const [schedRes, keyRes, trendRes, journalRes] = await Promise.all([
    supabase
      .from("schedule_days")
      .select("classes, training_time, schedule_templates!inner(is_active)")
      .eq("schedule_templates.is_active", true)
      .eq("weekday", weekday)
      .maybeSingle(),
    supabase.from("key_dates").select("label, kind").eq("date", ctx.today),
    supabase.from("score_snapshots").select("day, score").eq("scope", "overall").gte("day", addDays(ctx.today, -29)).order("day"),
    supabase.from("journal_entries").select("id, body, mood, created_at").order("created_at", { ascending: false }).limit(12),
  ]);

  const catSlug = Object.fromEntries(ctx.categories.map((c) => [c.id, c.slug]));
  const skillCat = new Map(ctx.skills.map((s) => [s.id, catSlug[s.category_id] ?? ""]));
  const skillBySlug = new Map(ctx.skills.map((s) => [s.slug, s]));
  const skillSlugById = new Map(ctx.skills.map((s) => [s.id, s.slug]));

  // ── Skill tiles.
  const skillInfo: Record<string, SkillTileInfo> = {};
  for (const s of ctx.skills) {
    const ms = ctx.milestones.filter((m) => m.skill_id === s.id);
    const nn = ctx.nonNegotiables.filter((n) => n.skill_id === s.id);
    const g = data.goals.find((x) => x.skillId === s.id && x.kind !== "stretch") ?? data.goals.find((x) => x.skillId === s.id);
    skillInfo[s.id] = {
      goals: nn.length,
      steps: ms.length,
      stepsDone: ms.filter((m) => m.claimed_at).length,
      today: g ? { title: g.title, result: g.resultTier, tier: g.tier } : null,
      firstGoal: nn[0] ? { name: nn[0].name, days: nn[0].days_of_week } : null,
    };
  }

  // ── Number tiles.
  const series = (key: string, n = 14) => ctx.metrics.filter((m) => m.key === key).slice(-n).map((m) => m.value);
  const latest = (key: string) => {
    const s = series(key, 1);
    return s.length ? s[0]! : null;
  };
  const weekSum = (key: string) => {
    const from = addDays(ctx.today, -6);
    const rows = ctx.metrics.filter((m) => m.key === key && m.day >= from);
    return rows.length ? rows.reduce((a, m) => a + m.value, 0) : null;
  };
  const { startDay } = sleepSettings(ctx);
  const sleepList = nights(
    ctx.sleepSessions.map((s) => ({ day: s.day, sleptAt: s.slept_at, wokeAt: s.woke_at })),
    tz,
    startDay,
  )
    .filter((n) => n.hours !== null)
    .slice(-14);
  const sleepHours = sleepList.map((n) => n.hours!);
  const runs = weekSum("run_mi");
  const tile = (key: string, label: string, unit: string, slug: string, logKey: string | null, value: number | null, s: number[], fmt?: (v: number) => string): NumberTile => {
    const sk = skillBySlug.get(slug);
    return {
      key,
      label,
      unit,
      category: sk ? (skillCat.get(sk.id) ?? "") : "",
      skillId: sk?.id ?? null,
      skillSlug: slug,
      logKey,
      value,
      display: value === null ? null : fmt ? fmt(value) : String(value),
      series: s,
    };
  };
  const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const numbers: NumberTile[] = [
    tile("weight", "Bodyweight", "lb", "strength", "bodyweight_lb", latest("bodyweight_lb"), series("bodyweight_lb"), one),
    tile("sleep", "Sleep, 14 nights", "h", "sleep", null, sleepHours.length ? sleepHours.reduce((a, b) => a + b, 0) / sleepHours.length : null, sleepHours, one),
    tile("chess", "Chess rating", "", "chess", "chess_rating", latest("chess_rating"), series("chess_rating"), (v) => Math.round(v).toLocaleString("en-US")),
    tile("revenue", "Revenue, this week", "$", "dropshipping", "revenue_week_usd", latest("revenue_week_usd"), series("revenue_week_usd"), (v) => `$${Math.round(v).toLocaleString("en-US")}`),
    runs !== null
      ? tile("miles", "Miles, this week", "mi", "running", "run_mi", runs, series("run_mi"), one)
      : tile("miles", "Long run", "mi", "running", "long_run_mi", latest("long_run_mi"), series("long_run_mi"), one),
    tile("wpm", "Reading rate", "wpm", "reading", null, latest("reading_effective_rate"), series("reading_effective_rate"), (v) => String(Math.round(v))),
  ];

  // ── Today's schedule: classes, training slot, key dates.
  const nowHM = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(ctx.now);
  const row = schedRes.data as { classes: { course: string; start: string; end: string }[] | null; training_time: string | null } | null;
  const items: Omit<ScheduleItem, "now">[] = [
    ...(row?.classes ?? []).map((c) => ({ time: c.start, end: c.end, title: c.course, sub: "Class", category: "school" })),
    ...(row?.training_time ? [{ time: row.training_time.slice(0, 5), end: null, title: "Training", sub: "Training slot", category: "athletics" }] : []),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));
  let marked = false;
  const schedule: ScheduleItem[] = items.map((i) => {
    const now = !marked && (i.end ?? i.time) >= nowHM;
    if (now) marked = true;
    return { ...i, now };
  });
  for (const k of (keyRes.data ?? []) as { label: string; kind: string }[]) {
    schedule.unshift({ time: "Today", end: null, title: k.label, sub: k.kind === "race" ? "Race day" : k.kind === "exam" ? "Exam" : "Key date", category: k.kind === "race" ? "athletics" : "school", now: false });
  }

  // ── Due soon: the next 7 days.
  const due = ctx.assignments
    .map((a) => ({ id: a.id, name: a.name, course: a.course, hours: Math.round((new Date(a.due_at).getTime() - ctx.now.getTime()) / 3_600_000) }))
    .filter((a) => a.hours >= 0 && a.hours <= 7 * 24)
    .slice(0, 5);

  // ── Activity: goal logs, numbers, step claims, journal.
  const when = (iso: string) => {
    const d = new Date(iso);
    const dayOf = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
    const diff = Math.round((Date.parse(dayOf(ctx.now)) - Date.parse(dayOf(d))) / 86_400_000);
    if (diff <= 0) return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    if (diff === 1) return "Yesterday";
    if (diff < 7) return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
  };
  const journalRows = (journalRes.error ? [] : (journalRes.data ?? [])) as { id: string; body: string; mood: string | null; created_at: string }[];
  const acts: Omit<ActivityItem, "when">[] = [
    ...ctx.goalRows
      .filter((g) => g.result_tier && g.completed_at)
      .map((g) => ({
        id: `g-${g.id}`,
        category: skillCat.get(g.skill_id) ?? "",
        what: `Logged ${g.title || g.text} at ${TIER_LABEL[g.result_tier!]}`,
        kind: "Goal" as const,
        at: g.completed_at!,
        skillSlug: skillSlugById.get(g.skill_id) ?? null,
      })),
    ...ctx.metrics
      .filter((m) => METRIC_BY_KEY.has(m.key))
      .slice(-40)
      .map((m) => ({
        id: `m-${m.id}`,
        category: m.skill_id ? (skillCat.get(m.skill_id) ?? "") : "",
        what: `${METRIC_BY_KEY.get(m.key)!.label}: ${formatMetric(METRIC_BY_KEY.get(m.key), m.value)}`,
        kind: "Number" as const,
        at: m.recorded_at,
        skillSlug: m.skill_id ? (skillSlugById.get(m.skill_id) ?? null) : null,
      })),
    ...ctx.milestones
      .filter((m) => m.claimed_at)
      .map((m) => ({
        id: `s-${m.id}`,
        category: skillCat.get(m.skill_id) ?? "",
        what: `Claimed ${m.title}, +${m.points}`,
        kind: "Step" as const,
        at: m.claimed_at!,
        skillSlug: skillSlugById.get(m.skill_id) ?? null,
      })),
    ...journalRows.map((j) => ({ id: `j-${j.id}`, category: "mind", what: `Journal: ${j.body}`, kind: "Journal" as const, at: j.created_at, skillSlug: null })),
  ];
  const activity = acts
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 12)
    .map((a) => ({ ...a, when: when(a.at) }));

  const trend = ((trendRes.data ?? []) as { day: string; score: number }[]).map((r) => ({ day: r.day, score: Number(r.score) }));
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${ctx.today}T12:00:00Z`));

  return {
    ...data,
    catSlug,
    skillInfo,
    numbers,
    schedule,
    due,
    trend,
    journal: journalRows.slice(0, 3).map((j) => ({ id: j.id, body: j.body, mood: j.mood, when: when(j.created_at) })),
    activity,
    dateLabel,
    dayType: DAY_TYPE[ctx.resolved.dayType] ?? "",
  };
}
