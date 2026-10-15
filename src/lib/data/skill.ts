import "server-only";
import { connection } from "next/server";
import { METRIC_BY_KEY, METRIC_DEFS, type MetricDef } from "@/engine/metrics";
import { displayScore, tipTier, type TipTier } from "@/engine/scoring";
import { addDays } from "@/engine/time";
import type { Tier } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import { autoClaim, metricValues } from "./claims";
import { loadUserContext, must } from "./context";
import { SHAPE_BY_CATEGORY, type BottleShape } from "./dashboard";

export type HeatDay = { day: string; state: Tier | "missed" | "none" };

export type MilestoneView = {
  id: string;
  title: string;
  points: number;
  type: string;
  claimedAt: string | null;
  proofUrl: string | null;
  proofValue: number | null;
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
  }[];
  milestones: MilestoneView[];
  metrics: { def: MetricDef; current: number | null; entries: { id: string; value: number; day: string; source: string }[] }[];
  log: { day: string; text: string; source: "note" | "goal" }[];
  rack: { pinned: boolean; daysLocked: number };
  claimed: string[];
  soundOn: boolean;
};

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
  const metrics = METRIC_DEFS.filter((d) => d.skill === row.slug).map((def) => ({
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
    tipTier: tier,
    tips: row.tips?.[tier] ?? [],
    tipUnlocked: row.status === "active" && TIP_ORDER.indexOf(tier) > TIP_ORDER.indexOf(seenTier) ? tier : null,
    history: ((snapRes.data ?? []) as { day: string; score: number }[]).map((s) => ({ day: s.day, score: Number(s.score) })),
    nonNegotiables,
    milestones,
    metrics,
    log,
    rack: { pinned: Boolean(pin), daysLocked },
    claimed,
    soundOn: ctx.profile.sound_on,
  };
}
