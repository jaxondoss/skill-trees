/**
 * Writes docs/redesign/room-prototype/data.js for the v3 room prototype.
 * Skills, categories, goals and steps come from the real seed template; every score comes from the real
 * engine (src/engine). The history behind the scores is synthetic and labelled SAMPLE.
 * Run: pnpm exec tsx scripts/room-proto-data.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeStreak, dailyCompletion } from "../src/engine/completion";
import { categoryScore, displayScore, figureTier, isNeglected, overallScore, scoreBreakdown, tipTier } from "../src/engine/scoring";
import { addDays } from "../src/engine/time";
import type { GoalKind, Tier } from "../src/engine/types";
import { SEED_TEMPLATE } from "../src/seed/template";

const TODAY = "2026-10-20";

/** mulberry32: deterministic sample history. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261020);

/** Sample profile per skill: share of milestone points claimed, and how often its goal gets done. */
const PROFILE: Record<string, { claim: number; hit: number; lastDoneAgo?: number }> = {
  "ai-building": { claim: 0.35, hit: 0.7 },
  dropshipping: { claim: 0.2, hit: 0.75 },
  academics: { claim: 0.55, hit: 0.85 },
  reading: { claim: 0.3, hit: 0.6 },
  "college-integration": { claim: 0.15, hit: 0.3, lastDoneAgo: 9 },
  "time-blocking": { claim: 0.4, hit: 0.8 },
  chess: { claim: 0.6, hit: 0.65 },
  meditation: { claim: 0.25, hit: 0.5 },
  visualization: { claim: 0.1, hit: 0.2, lastDoneAgo: 11 },
  strength: { claim: 0.7, hit: 0.9 },
  running: { claim: 0.45, hit: 0.8 },
  sleep: { claim: 0.35, hit: 0.55 },
  triathlon: { claim: 0, hit: 0 },
  food: { claim: 0.5, hit: 0.75 },
  "gut-health": { claim: 0.2, hit: 0.45 },
};

const RACK = SEED_TEMPLATE.rack;
type Goal = { id: string; skill: string; kind: GoalKind; tier: Tier; title: string; text: string; estMin: number; result: Tier | null; nmt: boolean };

const categories = SEED_TEMPLATE.categories.map((c) => ({ slug: c.slug, name: c.name }));
const skills: Record<string, unknown>[] = [];
const scored: { cat: string; status: string; priorityWeight: number; score: number }[] = [];

for (const c of SEED_TEMPLATE.categories) {
  for (const s of c.skills) {
    const p = PROFILE[s.slug] ?? { claim: 0.2, hit: 0.5 };
    let budget = 100 * p.claim;
    const steps = s.milestones.map((m) => {
      const claimed = budget >= m.points;
      if (claimed) budget -= m.points;
      return { title: m.title, points: m.points, claimed };
    });
    const history = [];
    let lastDone: string | null = null;
    for (let d = 27; d >= 1; d--) {
      const day = addDays(TODAY, -d);
      if (s.status !== "active") continue;
      const tooRecent = p.lastDoneAgo !== undefined && d < p.lastDoneAgo;
      const r = rand();
      const result: Tier | null = !tooRecent && r < p.hit ? (r < p.hit * 0.2 ? "floor" : "standard") : null;
      if (result) lastDone = day;
      history.push({ day, result });
    }
    const b = scoreBreakdown(steps.map((m) => ({ points: m.points, claimed: m.claimed })), history, TODAY);
    const score = s.status === "active" ? b.score : 0;
    scored.push({ cat: c.slug, status: s.status, priorityWeight: s.priorityWeight, score });
    skills.push({
      slug: s.slug,
      name: s.name,
      category: c.slug,
      status: s.status,
      identity: s.identity,
      score: Math.round(score * 10) / 10,
      display: displayScore(score),
      level: Math.round(b.level),
      consistency: Math.round(b.consistency),
      levelName: tipTier(score),
      neglected: isNeglected({ status: s.status, lastDone, activeSince: addDays(TODAY, -60) }, TODAY),
      pinned: RACK.includes(s.slug),
      goals: s.nonNegotiables.map((n) => ({ name: n.name, floor: n.floor, standard: n.standard, stretch: n.stretch, minutes: n.minutes, intention: n.intention })),
      steps,
    });
  }
}

const catScores = Object.fromEntries(
  categories.map((c) => [c.slug, categoryScore(scored.filter((s) => s.cat === c.slug).map(({ status, priorityWeight, score }) => ({ status: status as "active", priorityWeight, score })))]),
);
const overall = overallScore(Object.values(catScores));
const tier = figureTier(overall);

// Today's plan, shaped like the goal engine's output: one rack goal per pinned skill, two balance, one stretch.
const byslug = (slug: string) => skills.find((s) => s.slug === slug) as { slug: string; goals: { name: string; standard: string; floor: string; minutes: Record<Tier, number> }[] };
const mk = (slug: string, kind: GoalKind, result: Tier | null, tierPlanned: Tier = "standard", nmt = false): Goal => {
  const g = byslug(slug).goals[0]!;
  return { id: `${slug}-${kind}`, skill: slug, kind, tier: tierPlanned, title: g.name, text: tierPlanned === "floor" ? g.floor : g.standard, estMin: g.minutes[tierPlanned], result, nmt };
};
const goals: Goal[] = [
  mk("dropshipping", "rack", "standard"),
  mk("strength", "rack", "standard"),
  mk("running", "rack", null),
  mk("time-blocking", "rack", "floor"),
  mk("academics", "rack", null),
  mk("meditation", "balance", null, "floor", true),
  mk("food", "balance", "standard"),
  mk("chess", "stretch", null),
];
const todayP = dailyCompletion(goals.map((g) => ({ kind: g.kind, result: g.result }))).p ?? 0;

// 35 days of completion for the wall calendar and the streak.
const days = [] as { day: string; p: number | null }[];
for (let d = 35; d >= 1; d--) days.push({ day: addDays(TODAY, -d), p: d === 13 ? 62 : Math.round(86 + rand() * 14) });
const streak = computeStreak(
  days.map((d) => ({ day: d.day, p: d.p, nCore: 6, kept: (d.p ?? 0) >= 85 })) as Parameters<typeof computeStreak>[0],
  TODAY,
);

const data = {
  label: "SAMPLE STATE, NOT LIVE DATA",
  today: TODAY,
  weekdayLabel: "TUE 20 OCT",
  dayType: "CLASS HEAVY",
  focusLine: "Win the morning",
  overall: { score: Math.round(overall * 10) / 10, display: displayScore(overall), tier: tier.tier, numeral: tier.numeral, name: tier.name },
  categories: categories.map((c) => ({ ...c, score: catScores[c.slug] === null ? null : Math.round((catScores[c.slug] as number) * 10) / 10 })),
  skills,
  goals,
  todayP: Math.round(todayP),
  streak: { current: streak.current, best: streak.best },
  calendar: days,
  review: { weekly: false, monthly: false },
  dueSoon: [{ name: "CMPS 1500: Lab 6", hours: 30 }],
};

const fresh = {
  ...data,
  label: "FRESH ACCOUNT (EMPTY LISTS)",
  overall: { score: 15, display: 15, tier: 1, numeral: "I", name: "Raw" },
  categories: categories.map((c) => ({ ...c, score: c.slug === "athletics" ? 15 : 15 })),
  skills: (skills as { status: string }[]).map((s) => ({ ...s, score: s.status === "active" ? 15 : 0, display: s.status === "active" ? 15 : 0, level: 0, consistency: 50, levelName: "foundation", neglected: false, steps: [], goals: [] })),
  goals: [],
  todayP: 0,
  streak: { current: 0, best: 0 },
  calendar: [],
};

const out = join(__dirname, "..", "docs", "redesign", "room-prototype", "data.js");
writeFileSync(
  out,
  `// GENERATED by scripts/room-proto-data.ts. SAMPLE STATE, NOT LIVE DATA.\n// Skills, goals and steps come from src/seed/template.ts; scores come from src/engine.\nwindow.ROOM_DATA = ${JSON.stringify({ sample: data, fresh }, null, 1)};\n`,
);
console.log(`overall ${data.overall.display} tier ${data.overall.numeral} today ${data.todayP}% streak ${data.streak.current}/${data.streak.best}`);
for (const s of skills as { slug: string; display: number; neglected: boolean }[]) console.log(`  ${s.slug.padEnd(20)} ${String(s.display).padStart(3)}${s.neglected ? "  neglected" : ""}`);
