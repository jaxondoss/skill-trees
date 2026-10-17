import "server-only";
import { connection } from "next/server";
import { METRIC_BY_KEY, METRIC_DEFS, type MetricDef } from "@/engine/metrics";
import { displayScore, tipTier, type TipTier } from "@/engine/scoring";
import { addDays } from "@/engine/time";
import type { Tier } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import { calorieTarget, formatAfterNoon, nights, sleepAnchor } from "@/engine/trackers";
import { PASSAGES, READING_TEST_EVERY_DAYS } from "@/content/reading-passages";
import { claudeAvailable } from "@/lib/claude";
import { autoClaim, foodTargets, metricValues, sleepSettings } from "./claims";
import { loadUserContext, must } from "./context";
import { SHAPE_BY_CATEGORY, type BottleShape } from "./dashboard";
import { SEED_TEMPLATE } from "@/seed/template";

export type HeatDay = { day: string; state: Tier | "missed" | "none" };

export type MilestoneView = {
  id: string;
  title: string;
  points: number;
  type: string;
  claimedAt: string | null;
  proofUrl: string | null;
  proofValue: number | null;
  note: string | null;
  state: "claimed" | "next" | "future";
  /** Live progress toward a metric rule, e.g. Bench 240 / 255. */
  progress: { label: string; current: number | null; target: number; op: "gte" | "lte"; def: MetricDef | null } | null;
};

export type SkillPageData = {
  today: string;
  skill: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "dormant" | "archived";
    identity: string;
    hundredMeans: string;
    metricsNote: string | null;
    priorityWeight: number;
    finalScore: number | null;
  };
  category: { id: string; slug: string; name: string; color: string };
  shape: BottleShape;
  score: number;
  display: number;
  level: number;
  consistency: number;
  rawConsistency: number | null;
  countedDays: number;
  atCeiling: boolean;
  /** Sum of milestone points; a new skill builds up to 100. */
  milestonePoints: number;
  tipTier: TipTier;
  tips: string[];
  /** Crossed into a new tip tier since the last visit. */
  tipUnlocked: TipTier | null;
  history: { day: string; score: number }[];
  nonNegotiables: {
    id: string;
    name: string;
    texts: Record<Tier, string>;
    minutes: Record<Tier, number>;
    intention: string;
    defaultTier: Tier;
    daysOfWeek: number[];
    countsAgainstBudget: boolean;
    heat: HeatDay[];
    /** This goal on today's plan, when it is there. */
    todayGoal: { id: string; result: Tier | null; tier: Tier } | null;
  }[];
  /** Starter ideas from the template, offered in empty lists (spec v2 r2, 7). */
  ideas: { goals: { name: string; floor: string; standard: string; stretch: string; minutes: Record<Tier, number>; days: number[] }[]; steps: { title: string; points: number }[] };
  milestones: MilestoneView[];
  metrics: { def: MetricDef; current: number | null; entries: { id: string; value: number; day: string; source: string }[] }[];
  log: { day: string; text: string; source: "note" | "goal" }[];
  rack: { pinned: boolean; daysLocked: number };
  claimed: string[];
  soundOn: boolean;
  tracker: Tracker;
  viz: VizData;
};

/** Everything one skill's visualization draws from (spec v2 r2, 6). */
export type VizData = {
  slug: string;
  today: string;
  /** Metric entries by key, oldest first. */
  series: Record<string, { day: string; value: number; meta: Record<string, unknown> | null }[]>;
  /** This skill's goal results by day, last 26 weeks: best tier and its minutes. */
  goalDays: { day: string; result: Tier | null; minutes: number }[];
  nights: { day: string; bedtime: number; hours: number; anchor: number; inWindow: boolean }[];
  food: { days: { day: string; calories: number; protein: number }[]; calories: number; proteinG: number; tolerancePct: number } | null;
  due: { name: string; course: string | null; inDays: number }[];
  race: { label: string; date: string } | null;
  /** Milestone rule targets for this skill's numbers, e.g. bench_1rm 255. */
  targets: { key: string; value: number; claimed: boolean }[];
  habits: string[];
  costShare: number;
};

const VIZ_KEYS: Record<string, string[]> = {
  "ai-building": ["ship"],
  dropshipping: ["revenue_week_usd", "ad_spend_week_usd", "orders_week"],
  academics: ["course_grade"],
  reading: ["book_pages", "reading_effective_rate", "books_finished"],
  "college-integration": ["conversation"],
  "time-blocking": ["block_adherence_pct"],
  chess: ["chess_rating"],
  visualization: ["vividness", "vision_rewrites"],
  strength: ["bench_1rm", "squat_1rm", "deadlift_1rm"],
  running: ["run_mi", "long_run_mi"],
  triathlon: ["swim_min", "bike_min", "run_mi"],
  "gut-health": ["gut_habit", "gut_rating"],
};
const TIER_RANK: Record<Tier, number> = { floor: 1, standard: 2, stretch: 3 };

export type Tracker =
  | { kind: "sleep"; anchorTonight: string; open: boolean; nights: { day: string; hours: number | null; bedtime: string; inWindow: boolean }[] }
  | { kind: "food"; totals: { calories: number; proteinG: number; fiberG: number }; targets: { calories: number; proteinG: number; fiberG: number }; meals: number; claude: boolean }
  | { kind: "gut"; today: number | null }
  | { kind: "adherence"; today: number | null }
  | { kind: "assignments"; items: { id: string; name: string; course: string | null; dueAt: string; started: boolean; source: string; urgent: boolean }[] }
  | { kind: "chess"; connection: { platform: string; username: string; timeControl: string; lastSyncedAt: string | null; lastError: string | null } | null }
  | { kind: "timer" }
  | { kind: "woop" }
  | {
      kind: "reading";
      tests: { day: string; wpm: number | null; comprehensionPct: number | null; effectiveRate: number }[];
      nextDue: string | null;
      due: boolean;
      passageId: string;
      claude: boolean;
    }
  | { kind: "none" };

const TIP_ORDER: TipTier[] = ["foundation", "development", "mastery"];

export async function loadSkillPage(slug: string): Promise<SkillPageData | null> {
  await connection();
  const supabase = await createClient();
  let ctx = await loadUserContext(supabase, new Date());
  const claimed = await autoClaim(supabase, ctx);
  if (claimed.length) ctx = await loadUserContext(supabase, ctx.now);

  const row = ctx.skills.find((s) => s.slug === slug);
  if (!row) return null;
  const cat = ctx.categories.find((c) => c.id === row.category_id)!;
  const b = ctx.breakdowns.get(row.id)!;
  const tier = tipTier(b.score);
  const values = metricValues(ctx);

  const [snapRes, logRes] = await Promise.all([
    supabase.from("score_snapshots").select("day, score").eq("scope", "skill").eq("ref_id", row.id).order("day").limit(1000),
    supabase.from("skill_logs").select("day, body, created_at").eq("skill_id", row.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const seenTier = row.seen_tip_tier;

  // ── Non-negotiables with a 28-day heat strip.
  const goals = ctx.goalRows.filter((g) => g.skill_id === row.id);
  const nonNegotiables = ctx.nonNegotiables
    .filter((n) => n.skill_id === row.id)
    .map((n) => {
      const heat: HeatDay[] = [];
      for (let i = 27; i >= 0; i--) {
        const day = addDays(ctx.today, -i);
        const onDay = goals.filter((g) => g.non_negotiable_id === n.id && g.daily_plans.day === day);
        const best = onDay.map((g) => g.result_tier).find((r) => r === "stretch") ?? onDay.map((g) => g.result_tier).find((r) => r === "standard") ?? onDay.map((g) => g.result_tier).find((r) => r === "floor");
        heat.push({ day, state: best ?? (onDay.some((g) => g.kind !== "stretch") ? (day === ctx.today ? "none" : "missed") : "none") });
      }
      return {
        id: n.id,
        name: n.name,
        texts: { floor: n.floor_text, standard: n.standard_text, stretch: n.stretch_text },
        minutes: { floor: n.floor_min, standard: n.standard_min, stretch: n.stretch_min },
        intention: n.intention,
        defaultTier: n.default_tier,
        daysOfWeek: n.days_of_week,
        countsAgainstBudget: n.counts_against_budget,
        heat,
        todayGoal: (() => {
          const g = goals.find((x) => x.non_negotiable_id === n.id && x.daily_plans.day === ctx.today);
          return g ? { id: g.id, result: g.result_tier, tier: g.tier } : null;
        })(),
      };
    });

  // ── Milestone ladder.
  const ms = ctx.milestones.filter((m) => m.skill_id === row.id).sort((a, c) => a.sort - c.sort);
  const nextId = ms.find((m) => !m.claimed_at)?.id;
  const proofPaths = ms.filter((m) => m.proof_url).map((m) => m.proof_url!);
  const signed = new Map<string, string>();
  if (proofPaths.length) {
    const { data } = await supabase.storage.from("proofs").createSignedUrls(proofPaths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  const milestones: MilestoneView[] = ms.map((m) => ({
    id: m.id,
    title: m.title,
    points: m.points,
    type: m.type,
    claimedAt: m.claimed_at,
    proofUrl: m.proof_url ? (signed.get(m.proof_url) ?? null) : null,
    proofValue: m.proof_value === null ? null : Number(m.proof_value),
    note: m.note ?? null,
    state: m.claimed_at ? "claimed" : m.id === nextId ? "next" : "future",
    progress: m.rule
      ? {
          label: METRIC_BY_KEY.get(m.rule.key)?.label ?? m.rule.key.replace(/_/g, " "),
          current: values[m.rule.key] ?? null,
          target: Number(m.rule.value),
          op: m.rule.op,
          def: METRIC_BY_KEY.get(m.rule.key) ?? null,
        }
      : null,
  }));

  // ── Metrics this skill tracks.
  const metrics = METRIC_DEFS.filter((d) => d.skill === row.slug && !d.hidden).map((def) => ({
    def,
    current: values[def.key] ?? null,
    entries: ctx.metrics
      .filter((m) => m.key === def.key)
      .slice(-12)
      .reverse()
      .map((m) => ({ id: m.id, value: m.value, day: m.day, source: m.source })),
  }));

  // ── Log: one-line notes plus notes left on goals.
  const notes = ((must(logRes, "log") as { day: string; body: string }[]) ?? []).map((l) => ({ day: l.day, text: l.body, source: "note" as const }));
  const goalNotes = goals.filter((g) => g.user_note).map((g) => ({ day: g.daily_plans.day, text: g.user_note!, source: "goal" as const }));
  const log = [...notes, ...goalNotes].sort((a, c) => (a.day < c.day ? 1 : -1)).slice(0, 20);

  // ── The skill's visualization.
  const keys = VIZ_KEYS[row.slug] ?? [];
  const series: VizData["series"] = {};
  for (const k of keys) series[k] = ctx.metrics.filter((m) => m.key === k).map((m) => ({ day: m.day, value: m.value, meta: m.meta }));
  const since = addDays(ctx.today, -182);
  const nnMin = new Map(ctx.nonNegotiables.filter((n) => n.skill_id === row.id).map((n) => [n.id, { floor: n.floor_min, standard: n.standard_min, stretch: n.stretch_min }]));
  const byDay = new Map<string, { result: Tier | null; minutes: number }>();
  for (const g of goals) {
    const day = g.daily_plans.day;
    if (day < since) continue;
    const prev = byDay.get(day) ?? { result: null, minutes: 0 };
    if (g.result_tier && (!prev.result || TIER_RANK[g.result_tier] > TIER_RANK[prev.result])) {
      const mins = g.non_negotiable_id ? nnMin.get(g.non_negotiable_id)?.[g.result_tier] : undefined;
      byDay.set(day, { result: g.result_tier, minutes: mins ?? g.est_min ?? 0 });
    } else if (!byDay.has(day)) byDay.set(day, prev);
  }
  const goalDays = [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, c) => (a.day < c.day ? -1 : 1));
  let nightRows: VizData["nights"] = [];
  if (row.slug === "sleep") {
    const { cfg, startDay } = sleepSettings(ctx);
    nightRows = nights(ctx.sleepSessions.map((x) => ({ day: x.day, sleptAt: x.slept_at, wokeAt: x.woke_at })), ctx.profile.timezone, startDay, cfg)
      .filter((n) => n.hours !== null)
      .slice(-14)
      .map((n) => ({ day: n.day, bedtime: n.bedtime, hours: n.hours!, anchor: n.anchor, inWindow: n.inWindow }));
  }
  let food: VizData["food"] = null;
  if (row.slug === "food") {
    const t = foodTargets(ctx);
    const sums = new Map<string, { calories: number; protein: number }>();
    for (const m of ctx.metrics) {
      if (m.key !== "meal_calories" && m.key !== "meal_protein_g") continue;
      if (m.day < addDays(ctx.today, -13)) continue;
      const d = sums.get(m.day) ?? { calories: 0, protein: 0 };
      if (m.key === "meal_calories") d.calories += m.value;
      else d.protein += m.value;
      sums.set(m.day, d);
    }
    food = { days: [...sums.entries()].map(([day, v]) => ({ day, ...v })).sort((a, c) => (a.day < c.day ? -1 : 1)), calories: t.calories, proteinG: t.proteinG, tolerancePct: t.calorieTolerancePct };
  }
  let race: VizData["race"] = null;
  if (row.slug === "running" || row.slug === "triathlon") {
    const { data: kd } = await supabase.from("key_dates").select("label, date").eq("kind", "race").gte("date", ctx.today).order("date").limit(1);
    const k = (kd ?? [])[0] as { label: string; date: string } | undefined;
    race = k ? { label: k.label, date: k.date } : null;
  }
  const cfg = (row.config ?? {}) as { habits?: string[]; productCostPct?: number };
  const viz: VizData = {
    slug: row.slug,
    today: ctx.today,
    series,
    goalDays,
    nights: nightRows,
    food,
    due:
      row.slug === "academics"
        ? ctx.assignments
            .map((a) => ({ name: a.name, course: a.course, inDays: (new Date(a.due_at).getTime() - ctx.now.getTime()) / 86_400_000 }))
            .filter((a) => a.inDays >= 0 && a.inDays <= 14)
        : [],
    race,
    targets: ms.filter((m) => m.rule && keys.includes(m.rule.key)).map((m) => ({ key: m.rule!.key, value: Number(m.rule!.value), claimed: !!m.claimed_at })),
    habits: Array.isArray(cfg.habits) && cfg.habits.length ? cfg.habits.slice(0, 6) : ["Fiber 38 g", "Fermented food", "Water 3 L", "No late snack"],
    costShare: typeof cfg.productCostPct === "number" ? cfg.productCostPct / 100 : 0.35,
  };

  const pin = ctx.rackPins.find((p) => p.skill_id === row.id);
  const daysLocked = pin ? Math.max(0, Math.ceil((new Date(pin.locked_until).getTime() - ctx.now.getTime()) / 86_400_000)) : 0;

  return {
    today: ctx.today,
    skill: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      identity: row.identity,
      hundredMeans: row.hundred_means,
      metricsNote: row.metrics_note,
      priorityWeight: row.priority_weight,
      finalScore: row.final_score === null ? null : Number(row.final_score),
    },
    category: { id: cat.id, slug: cat.slug, name: cat.name, color: cat.color },
    shape: SHAPE_BY_CATEGORY[cat.slug] ?? "round",
    score: b.score,
    display: displayScore(b.score),
    level: b.level,
    consistency: b.consistency,
    rawConsistency: b.rawConsistency,
    countedDays: b.countedDays,
    atCeiling: b.atCeiling,
    milestonePoints: ctx.milestones.filter((m) => m.skill_id === row.id).reduce((sum, m) => sum + m.points, 0),
    tipTier: tier,
    tips: row.tips?.[tier] ?? [],
    tipUnlocked: row.status === "active" && TIP_ORDER.indexOf(tier) > TIP_ORDER.indexOf(seenTier) ? tier : null,
    history: ((snapRes.data ?? []) as { day: string; score: number }[]).map((s) => ({ day: s.day, score: Number(s.score) })),
    nonNegotiables,
    ideas: starterIdeas(row.slug),
    milestones,
    metrics,
    log,
    rack: { pinned: Boolean(pin), daysLocked },
    claimed,
    soundOn: ctx.profile.sound_on,
    tracker: trackerFor(row.slug, ctx),
    viz,
  };
}

function trackerFor(slug: string, ctx: Awaited<ReturnType<typeof loadUserContext>>): Tracker {
  const todayValue = (key: string) => ctx.metrics.filter((m) => m.key === key && m.day === ctx.today).at(-1)?.value ?? null;
  switch (slug) {
    case "sleep": {
      const { cfg, startDay } = sleepSettings(ctx);
      const list = nights(
        ctx.sleepSessions.map((s) => ({ day: s.day, sleptAt: s.slept_at, wokeAt: s.woke_at })),
        ctx.profile.timezone,
        startDay,
        cfg,
      );
      return {
        kind: "sleep",
        anchorTonight: formatAfterNoon(sleepAnchor(ctx.today, startDay, cfg)),
        open: ctx.sleepSessions.some((s) => !s.woke_at && ctx.now.getTime() - new Date(s.slept_at).getTime() < 18 * 3_600_000),
        nights: list.slice(-7).reverse().map((n) => ({ day: n.day, hours: n.hours, bedtime: formatAfterNoon(n.bedtime), inWindow: n.inWindow })),
      };
    }
    case "food": {
      const t = foodTargets(ctx);
      const sum = (key: string) => ctx.metrics.filter((m) => m.key === key && m.day === ctx.today).reduce((s, m) => s + m.value, 0);
      const longRunToday = ctx.metrics.filter((m) => m.key === "long_run_mi" && m.day === ctx.today).at(-1)?.value ?? null;
      return {
        kind: "food",
        totals: { calories: sum("meal_calories"), proteinG: sum("meal_protein_g"), fiberG: sum("meal_fiber_g") },
        targets: { calories: calorieTarget(t.calories, longRunToday), proteinG: t.proteinG, fiberG: 38 },
        meals: ctx.metrics.filter((m) => m.key === "meal_calories" && m.day === ctx.today).length,
        claude: claudeAvailable(),
      };
    }
    case "gut-health":
      return { kind: "gut", today: todayValue("gut_rating") };
    case "time-blocking":
      return { kind: "adherence", today: todayValue("block_adherence_pct") };
    case "academics":
      return {
        kind: "assignments",
        items: ctx.assignments.map((a) => ({
          id: a.id,
          name: a.name,
          course: a.course,
          dueAt: a.due_at,
          started: a.started,
          source: a.source,
          // Same 48-hour rule the goal engine applies.
          urgent: !a.started && new Date(a.due_at).getTime() - ctx.now.getTime() <= 48 * 3_600_000,
        })),
      };
    case "chess": {
      const row = ctx.integrations.find((i) => i.provider === "chess");
      const c = (row?.config ?? {}) as { platform?: string; username?: string; timeControl?: string };
      return {
        kind: "chess",
        connection: row ? { platform: c.platform ?? "", username: c.username ?? "", timeControl: c.timeControl ?? "rapid", lastSyncedAt: row.last_synced_at, lastError: row.last_error } : null,
      };
    }
    case "meditation":
      return { kind: "timer" };
    case "visualization":
      return { kind: "woop" };
    case "reading": {
      const rows = ctx.metrics.filter((m) => m.key === "reading_effective_rate");
      const num = (v: unknown) => (typeof v === "number" ? v : null);
      const tests = rows.map((m) => ({ day: m.day, wpm: num(m.meta?.wpm), comprehensionPct: num(m.meta?.comprehensionPct), effectiveRate: m.value }));
      const last = tests.at(-1);
      const nextDue = last ? addDays(last.day, READING_TEST_EVERY_DAYS) : null;
      const taken = new Set(rows.map((m) => m.meta?.passageId).filter((id): id is string => typeof id === "string"));
      const passage = PASSAGES.find((p) => !taken.has(p.id)) ?? PASSAGES[tests.length % PASSAGES.length]!;
      return { kind: "reading", tests: tests.slice(-6).reverse(), nextDue, due: !nextDue || nextDue <= ctx.today, passageId: passage.id, claude: claudeAvailable() };
    }
    default:
      return { kind: "none" };
  }
}

/** The template's goals and steps for a skill, offered as one-tap ideas in empty to-do lists. */
function starterIdeas(slug: string): SkillPageData["ideas"] {
  const t = SEED_TEMPLATE.categories.flatMap((c) => c.skills).find((s) => s.slug === slug);
  if (!t) return { goals: [], steps: [] };
  return {
    goals: t.nonNegotiables.map((n) => ({
      name: n.name,
      floor: n.floor,
      standard: n.standard,
      stretch: n.stretch,
      minutes: n.minutes ?? { floor: 0, standard: 0, stretch: 0 },
      days: [...(n.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6])],
    })),
    steps: t.milestones.map((m) => ({ title: m.title, points: m.points })),
  };
}
