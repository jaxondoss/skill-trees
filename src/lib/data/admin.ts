import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { addDays } from "@/engine/time";
import type { Tier } from "@/engine/types";
import { isAdmin } from "@/lib/admin";
import { FEATURE_TILES, skillTileId, tileOfObject, type Plan } from "@/lib/admin-items";
import { createClient } from "@/lib/supabase/server";
import planJson from "../../../public/room/plan.json";
import { loadRoomDataWithContext } from "./room";

export const PLAN = planJson as unknown as Plan;

/** The signed-in user's admin flag (ADMIN_EMAILS), from the verified session claims. */
export async function currentUserIsAdmin(supabase?: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const client = supabase ?? (await createClient());
  const { data } = await client.auth.getClaims();
  return isAdmin({ email: typeof data?.claims?.email === "string" ? data.claims.email : null });
}

export type AdminTile = {
  id: string;
  kind: "skill" | "feature";
  title: string;
  /** 0..100 display score, null when it has none (dormant, a feature without a score) */
  score: number | null;
  /** stage label: Foundation / Development / Mastery, a tier name, or a short fact */
  stage: string;
  /** up to 31 daily scores, oldest first */
  spark: number[];
  streak: number | null;
  daysSince: number | null;
  neglected: boolean;
  status: "active" | "dormant" | "archived" | null;
  category: string | null;
  /** plan object ids drawn for this tile */
  objects: string[];
  /** today's goal for a skill tile (quick log) */
  goal: { id: string; tier: Tier; result: Tier | null; title: string } | null;
  note: string | null;
};

export type AdminSkill = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "dormant" | "archived";
  categoryId: string;
  pinSlot: number | null;
  pinLockedUntil: string | null;
  goals: {
    id: string;
    name: string;
    texts: { floor: string; standard: string; stretch: string };
    minutes: { floor: number; standard: number; stretch: number };
    intention: string;
    defaultTier: Tier;
    daysOfWeek: number[];
  }[];
};

export type AdminData = Awaited<ReturnType<typeof buildAdminData>>;

/** Everything /admin shows. Null for a non-admin (the page 404s). Once per request: the layout and page share it. */
export const loadAdminData = cache(async () => {
  // Request-time only: the session and the clock are read below.
  await connection();
  const supabase = await createClient();
  if (!(await currentUserIsAdmin(supabase))) return null;
  return buildAdminData(supabase);
});

async function buildAdminData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { room, ctx, dashboard } = await loadRoomDataWithContext();
  const since = addDays(ctx.today, -30);
  const { data: snapRows } = await supabase
    .from("score_snapshots")
    .select("scope, ref_id, day, score")
    .in("scope", ["skill", "overall", "category"])
    .gte("day", since)
    .order("day");
  const snaps = (snapRows ?? []) as { scope: string; ref_id: string | null; day: string; score: number }[];
  const sparkOf = (scope: string, ref: string | null) => snaps.filter((r) => r.scope === scope && r.ref_id === ref).map((r) => Math.round(Number(r.score)));

  const objectsOf = new Map<string, string[]>();
  for (const o of PLAN.objects) {
    const t = tileOfObject(o);
    if (t) objectsOf.set(t, [...(objectsOf.get(t) ?? []), o.id]);
  }

  // today's goals as the room has them (ctx.goalRows predates the plan saved on the first open of the day)
  const skillTiles: AdminTile[] = room.skills.map((s) => {
    const g = room.goals.find((r) => r.skill === s.slug && r.kind !== "stretch") ?? room.goals.find((r) => r.skill === s.slug);
    const dormant = s.status === "dormant";
    return {
      id: skillTileId(s.slug),
      kind: "skill",
      title: s.name,
      score: dormant ? null : s.display,
      stage: s.status === "active" ? s.levelName[0]!.toUpperCase() + s.levelName.slice(1) : s.status === "dormant" ? "Paused" : "Archived",
      spark: sparkOf("skill", s.id),
      streak: s.streak,
      daysSince: s.lastLoggedDaysAgo,
      neglected: s.neglected,
      status: s.status,
      category: s.category,
      objects: objectsOf.get(skillTileId(s.slug)) ?? [],
      goal: g ? { id: g.id, tier: g.tier, result: g.result, title: g.title } : null,
      note: s.pinned ? "On the rack" : null,
    };
  });

  const o = room.overall;
  const archived = room.skills.filter((s) => s.status === "archived").length;
  const relicsActive = Object.values(room.relics.slots).filter(Boolean).length;
  const feature = (id: string, f: Partial<AdminTile>): AdminTile => ({
    id,
    kind: "feature",
    title: FEATURE_TILES.find((t) => t.id === id)!.title,
    score: null,
    stage: "",
    spark: [],
    streak: null,
    daysSince: null,
    neglected: false,
    status: null,
    category: null,
    objects: objectsOf.get(id) ?? [],
    goal: null,
    note: null,
    ...f,
  });
  const lowCat = [...dashboard.categories].filter((c) => c.score !== null).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const featureTiles: AdminTile[] = [
    feature("overall", { score: o.display, stage: `Tier ${o.numeral}: ${o.name}`, spark: sparkOf("overall", null), streak: room.streak.current }),
    feature("categories", { stage: `${dashboard.categories.length} categories`, note: lowCat ? `Lowest: ${lowCat.name} ${lowCat.display}` : null }),
    feature("board", { score: room.todayP, stage: "Today done", streak: room.streak.current, note: `${room.goals.filter((g) => g.result).length} of ${room.goals.length} goals` }),
    feature("calendar", { score: room.todayP, stage: "Completion", spark: room.calendar.slice(-30).map((c) => c.p), streak: room.streak.current }),
    feature("review", { stage: room.review.weekly ? "Due now" : "Sundays", neglected: !!room.review.weekly }),
    feature("review/month", { stage: room.review.monthly ? "Due now" : "First Sunday", neglected: !!room.review.monthly }),
    feature("relics", { stage: `${relicsActive} of 3 mounted`, note: `${room.relics.trophies.length} achieved` }),
    feature("archive", { stage: `${archived} archived` }),
    feature("settings", { stage: "Schedule, keys, integrations" }),
    feature("debug", { stage: "Time, weather, tier" }),
  ];

  const pins = new Map(ctx.rackPins.map((p) => [p.skill_id, p]));
  const skills: AdminSkill[] = ctx.skills.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    status: s.status,
    categoryId: s.category_id,
    pinSlot: pins.get(s.id)?.slot ?? null,
    pinLockedUntil: pins.get(s.id)?.locked_until ?? null,
    goals: ctx.nonNegotiables
      .filter((n) => n.skill_id === s.id)
      .map((n) => ({
        id: n.id,
        name: n.name,
        texts: { floor: n.floor_text, standard: n.standard_text, stretch: n.stretch_text },
        minutes: { floor: n.floor_min, standard: n.standard_min, stretch: n.stretch_min },
        intention: n.intention,
        defaultTier: n.default_tier,
        daysOfWeek: n.days_of_week,
      })),
  }));

  return {
    today: ctx.today,
    plan: PLAN,
    tiles: [...skillTiles, ...featureTiles],
    skills,
    categories: ctx.categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
    overall: { display: o.display, numeral: o.numeral, name: o.name, tier: o.tier },
    relics: room.relics,
  };
}
