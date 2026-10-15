import { daysBetween } from "./time";
import type { DayKey, EngineMilestone, GoalRecord, SkillStatus, Tier } from "./types";

// ───────────────────────────── Level (L)

/** Sum of claimed milestone points, capped at 100. Permanent: misses never touch it. */
export function levelScore(milestones: Pick<EngineMilestone, "points" | "claimed">[]): number {
  const sum = milestones.reduce((s, m) => s + (m.claimed ? m.points : 0), 0);
  return Math.min(100, sum);
}

/** Milestone ids whose auto-claim rule is now satisfied. Values come from metrics or derived counters. */
export function milestonesToClaim(milestones: EngineMilestone[], values: Record<string, number | undefined>): string[] {
  return milestones
    .filter((m) => {
      if (m.claimed || !m.rule) return false;
      const v = values[m.rule.key];
      if (v === undefined || !Number.isFinite(v)) return false;
      return m.rule.op === "gte" ? v >= m.rule.value : v <= m.rule.value;
    })
    .map((m) => m.id);
}

// ───────────────────────────── Consistency (C)

export const CONSISTENCY_WINDOW_DAYS = 28;
export const CONSISTENCY_DECAY = 0.95;
export const COLD_START_DAYS = 7;

/** Stretch is capped at 1.0 here; it only earns extra in the daily completion P. */
const CONSISTENCY_VALUE: Record<Tier, number> = { floor: 0.5, standard: 1, stretch: 1 };

export type ConsistencyResult = {
  /** Effective C after the cold-start blend (0 to 100). */
  value: number;
  /** Raw recency-weighted C before blending, or null with no counted days. */
  raw: number | null;
  /** Scheduled days counted in the window. */
  n: number;
};

/**
 * Recency-weighted completion of one skill's goals over the last 28 days (spec 6.2).
 * - A day counts only if the skill had a goal in that day's plan; other days are skipped.
 * - Several goals for the skill on one day collapse to the best result.
 * - Today counts only once logged: an unchecked goal is not a miss until the day closes.
 * - Fewer than 7 counted days blends toward 50.
 */
export function consistency(goals: Pick<GoalRecord, "day" | "result">[], today: DayKey): ConsistencyResult {
  const best = new Map<DayKey, number>();
  for (const g of goals) {
    const d = daysBetween(g.day, today);
    if (d < 0 || d >= CONSISTENCY_WINDOW_DAYS) continue;
    const x = g.result ? CONSISTENCY_VALUE[g.result] : 0;
    best.set(g.day, Math.max(best.get(g.day) ?? 0, x));
  }

  let num = 0;
  let den = 0;
  let n = 0;
  for (const [day, x] of best) {
    const d = daysBetween(day, today);
    if (d === 0 && x === 0) continue; // today, not logged yet
    const w = CONSISTENCY_DECAY ** d;
    num += w * x;
    den += w;
    n += 1;
  }

  const raw = den > 0 ? (100 * num) / den : null;
  const k = Math.min(n, COLD_START_DAYS) / COLD_START_DAYS;
  const value = raw === null ? 50 : k * raw + (1 - k) * 50;
  return { value, raw, n };
}

// ───────────────────────────── Skill, category, overall

export type SkillBreakdown = {
  score: number;
  level: number;
  consistency: number;
  rawConsistency: number | null;
  countedDays: number;
  /** All milestones claimed: prompt "Raise the ceiling". */
  atCeiling: boolean;
};

export function skillScore(level: number, consistencyValue: number): number {
  return 0.7 * level + 0.3 * consistencyValue;
}

/** S = 0.7 L + 0.3 C, with every part returned so the number on screen is explainable. */
export function scoreBreakdown(
  milestones: Pick<EngineMilestone, "points" | "claimed">[],
  goals: Pick<GoalRecord, "day" | "result">[],
  today: DayKey,
): SkillBreakdown {
  const level = levelScore(milestones);
  const c = consistency(goals, today);
  return {
    score: skillScore(level, c.value),
    level,
    consistency: c.value,
    rawConsistency: c.raw,
    countedDays: c.n,
    atCeiling: level >= 100,
  };
}

export type ScoredSkill = { status: SkillStatus; priorityWeight: number; score: number };

/** Priority-weighted mean of active skills. Null when the category has no active skill. */
export function categoryScore(skills: ScoredSkill[]): number | null {
  let num = 0;
  let den = 0;
  for (const s of skills) {
    if (s.status !== "active") continue;
    num += s.priorityWeight * s.score;
    den += s.priorityWeight;
  }
  return den > 0 ? num / den : null;
}

/** Equal-weighted mean of categories, on purpose: a lopsided life should not reach Sovereign. */
export function overallScore(categoryScores: (number | null)[]): number {
  const present = categoryScores.filter((s): s is number => s !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0;
}

// ───────────────────────────── Tiers and visuals

/** Tiers read the rounded score, so the number on screen and the tier name always agree. */
export function displayScore(score: number): number {
  return Math.round(Math.max(0, Math.min(100, score)));
}

export const FIGURE_TIERS = [
  { tier: 1, numeral: "I", name: "Raw", min: 0 },
  { tier: 2, numeral: "II", name: "Awakened", min: 20 },
  { tier: 3, numeral: "III", name: "Forged", min: 40 },
  { tier: 4, numeral: "IV", name: "Ascendant", min: 60 },
  { tier: 5, numeral: "V", name: "Sovereign", min: 80 },
] as const;
export type FigureTier = (typeof FIGURE_TIERS)[number];

export function figureTier(overall: number): FigureTier {
  const s = displayScore(overall);
  return [...FIGURE_TIERS].reverse().find((t) => s >= t.min) ?? FIGURE_TIERS[0];
}

export type TipTier = "foundation" | "development" | "mastery";

export function tipTier(score: number): TipTier {
  const s = displayScore(score);
  return s >= 67 ? "mastery" : s >= 34 ? "development" : "foundation";
}

/** Returns the newly unlocked tip tier when a score rises across 34 or 67, otherwise null. */
export function tipTierUnlocked(before: number, after: number): TipTier | null {
  const order: TipTier[] = ["foundation", "development", "mastery"];
  const a = tipTier(before);
  const b = tipTier(after);
  return order.indexOf(b) > order.indexOf(a) ? b : null;
}

/** Vein opacity for a figure region (spec 5.3). */
export function regionOpacity(categoryScore: number): number {
  return 0.15 + (0.85 * Math.max(0, Math.min(100, categoryScore))) / 100;
}

export const NEGLECT_DAYS = 7;

/** No completion for 7+ days (counting from when the skill became active if never done). */
export function isNeglected(
  skill: { status: SkillStatus; lastDone: DayKey | null; activeSince: DayKey },
  today: DayKey,
): boolean {
  if (skill.status !== "active") return false;
  return daysBetween(skill.lastDone ?? skill.activeSince, today) >= NEGLECT_DAYS;
}

/** Change vs 7 days ago, and the bottle arrow (only when it moved more than 2 points). */
export function trend(current: number, weekAgo: number | null): { delta: number | null; arrow: "up" | "down" | null } {
  if (weekAgo === null) return { delta: null, arrow: null };
  const delta = current - weekAgo;
  return { delta, arrow: delta > 2 ? "up" : delta < -2 ? "down" : null };
}

// ───────────────────────────── Snapshots

export type SnapshotSkill = {
  id: string;
  categoryId: string;
  status: SkillStatus;
  priorityWeight: number;
  breakdown: Pick<SkillBreakdown, "score" | "level" | "consistency">;
};

export type SnapshotRow = {
  day: DayKey;
  scope: "skill" | "category" | "overall";
  refId: string | null;
  score: number;
  level: number | null;
  consistency: number | null;
};

/** One row per active skill, per category with active skills, and overall (spec 6.6). */
export function buildSnapshots(day: DayKey, categoryIds: string[], skills: SnapshotSkill[]): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const s of skills) {
    if (s.status !== "active") continue;
    rows.push({ day, scope: "skill", refId: s.id, score: s.breakdown.score, level: s.breakdown.level, consistency: s.breakdown.consistency });
  }
  const catScores = categoryIds.map((id) => {
    const score = categoryScore(
      skills.filter((s) => s.categoryId === id).map((s) => ({ status: s.status, priorityWeight: s.priorityWeight, score: s.breakdown.score })),
    );
    if (score !== null) rows.push({ day, scope: "category", refId: id, score, level: null, consistency: null });
    return score;
  });
  rows.push({ day, scope: "overall", refId: null, score: overallScore(catScores), level: null, consistency: null });
  return rows;
}
