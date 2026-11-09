/**
 * Admin view item model (pure): the floor plan's shape, which tile each room hotspot belongs to, the tile ids
 * (also the URL under /admin), and the perimeter layout order. Unit tested in tests/unit/admin.test.ts.
 */

export type Wall = "front" | "right" | "back" | "left";

export type PlanObject = {
  id: string;
  kind: string;
  src?: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  h: number;
  wall: Wall | null;
  view: string;
  zone: string | null;
  label: string;
  target: { skill?: string; feature?: string } | null;
};

export type Plan = {
  room: { w: number; d: number; x0: number; z0: number };
  walls: { side: Wall; x0: number; z0: number; x1: number; z1: number }[];
  openings: { kind: string; wall: Wall; x0: number; z0: number; x1: number; z1: number }[];
  ceiling: { kind: string; x0: number; z0: number; x1: number; z1: number }[];
  objects: PlanObject[];
};

/** Feature tiles, in the order they fill free perimeter slots. Ids double as the /admin/<id> path. */
export const FEATURE_TILES = [
  { id: "overall", title: "Overall" },
  { id: "categories", title: "Categories" },
  { id: "board", title: "Board + Today" },
  { id: "calendar", title: "Calendar" },
  { id: "review", title: "Weekly review" },
  { id: "review/month", title: "Monthly review" },
  { id: "relics", title: "Relics" },
  { id: "archive", title: "Archive" },
  { id: "settings", title: "Settings" },
  { id: "debug", title: "Room debug" },
] as const;

export type FeatureTileId = (typeof FEATURE_TILES)[number]["id"];

/** Room feature target -> feature tile. Everything the room opens has a home here. */
export const FEATURE_OF: Record<string, FeatureTileId> = {
  overall: "overall",
  stats: "board",
  today: "board",
  courses: "board",
  journal: "board",
  focus: "board",
  calendar: "calendar",
  review: "review",
  settings: "settings",
  archive: "archive",
  "relic-window": "relics",
  "relic-right": "relics",
  "relic-left": "relics",
};

export const skillTileId = (slug: string) => `s/${slug}`;

/** The tile a plan object belongs to, or null when its target is unknown. */
export function tileOfObject(o: Pick<PlanObject, "target">): string | null {
  if (o.target?.skill) return skillTileId(o.target.skill);
  if (o.target?.feature) return FEATURE_OF[o.target.feature] ?? null;
  return null;
}

/** /admin/<...item> segments -> a tile id, or null (plain /admin). Unknown ids are rejected by the caller. */
export function itemFromSegments(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  return segments.map((s) => decodeURIComponent(s)).join("/");
}

/** A tile id is valid when it is a feature tile or s/<slug> for a known skill. */
export function isTileId(id: string, skillSlugs: Iterable<string>): boolean {
  if (FEATURE_TILES.some((f) => f.id === id)) return true;
  const m = /^s\/([a-z0-9-]+)$/.exec(id);
  return !!m && new Set(skillSlugs).has(m[1]!);
}

/** Centre of an object's footprint (world ft). */
export const centreOf = (o: Pick<PlanObject, "x0" | "x1" | "z0" | "z1">) => ({ x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 });

/**
 * Clockwise position around the room for tile ordering, 0..1, starting at the top-left corner of the plan
 * (the plan draws the window wall at the top: screen x = X, screen y = -Z).
 */
export function perimeterT(x: number, z: number): number {
  // angle of (x, -z) measured clockwise from the direction of the top-left corner
  const a = Math.atan2(-z, x); // screen angle, y down: atan2(sy, sx)
  const start = Math.atan2(-1, -1); // top-left corner direction (-135 deg)
  let t = (a - start) / (2 * Math.PI);
  t -= Math.floor(t);
  return t;
}

/** Perimeter side for a position along the clockwise loop (top, right, bottom, left quarters). */
export function sideOfT(t: number): "top" | "right" | "bottom" | "left" {
  return t < 0.25 ? "top" : t < 0.5 ? "right" : t < 0.75 ? "bottom" : "left";
}

/**
 * Lay tiles around the plan: tiles with objects in clockwise order of their objects, then fill free slots with the
 * rest. Capacities per side (top, right, bottom, left) come from the layout; returns tile ids per side, in reading
 * order for the top and bottom rows (left to right) and for the side columns (top to bottom).
 */
export function layoutSides(
  placed: { id: string; t: number }[],
  unplaced: string[],
  cap: { top: number; right: number; bottom: number; left: number },
): { top: string[]; right: string[]; bottom: string[]; left: string[] } {
  const loop = [...placed].sort((a, b) => a.t - b.t);
  const sides = { top: [] as { id: string; t: number }[], right: [] as { id: string; t: number }[], bottom: [] as { id: string; t: number }[], left: [] as { id: string; t: number }[] };
  for (const p of loop) sides[sideOfT(p.t)].push(p);
  // spill overfull sides clockwise into the next side (keeps the loop order, so leader lines do not cross)
  const order = ["top", "right", "bottom", "left"] as const;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 4; i++) {
      const s = order[i]!;
      const next = order[(i + 1) % 4]!;
      while (sides[s].length > cap[s]) sides[next].unshift(sides[s].pop()!);
    }
  }
  const out = { top: sides.top.map((p) => p.id), right: sides.right.map((p) => p.id), bottom: sides.bottom.map((p) => p.id).reverse(), left: sides.left.map((p) => p.id).reverse() };
  // bottom and left run against the loop, so reading order is reversed above; free slots take the rest
  const rest = [...unplaced];
  for (const s of ["bottom", "top", "right", "left"] as const) {
    while (rest.length && out[s].length < cap[s]) out[s].push(rest.shift()!);
  }
  out.bottom.push(...rest);
  return out;
}

/** Plan callout size (ft) and the minimum centre distance between two callouts. */
export const TAG = 0.95;
const TAG_MIN = TAG + 0.2;

/**
 * Callout positions in plan coordinates (x = X, y = -Z): wall items are pulled 1.25 ft into the room, floor items sit
 * on their centre; then overlapping callouts are pushed apart (wall callouts slide along their wall). Deterministic.
 */
export function placeTags(objects: PlanObject[]): Map<string, { x: number; y: number; ax: number; ay: number }> {
  const pull = 1.25;
  const tags = objects.map((o) => {
    let x = (o.x0 + o.x1) / 2;
    let z = (o.z0 + o.z1) / 2;
    if (o.wall === "front") z = o.z1 - pull;
    if (o.wall === "back") z = o.z0 + pull;
    if (o.wall === "right") x = o.x1 - pull;
    if (o.wall === "left") x = o.x0 + pull;
    // slide axis: along the wall for wall items, free for floor items
    const along = o.wall === "front" || o.wall === "back" ? "x" : o.wall ? "y" : "xy";
    return { id: o.id, x, y: -z, ax: (o.x0 + o.x1) / 2, ay: -(o.z0 + o.z1) / 2, along };
  });
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i]!;
        const b = tags[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= TAG_MIN || Math.abs(dy) >= TAG_MIN) continue;
        moved = true;
        // push along the axis with the smaller overlap that both may use; ties break by id order (stable)
        const canX = a.along !== "y" || b.along !== "y";
        const canY = a.along !== "x" || b.along !== "x";
        const useX = canX && (!canY || TAG_MIN - Math.abs(dx) <= TAG_MIN - Math.abs(dy));
        const d = useX ? dx : dy;
        const need = (TAG_MIN - Math.abs(d)) / 2 + 0.01;
        const sgn = d === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(d);
        const k = useX ? "x" : "y";
        const aMay = a.along === "xy" || a.along === k;
        const bMay = b.along === "xy" || b.along === k;
        const share = aMay && bMay ? 1 : 2;
        if (aMay) a[k] -= sgn * need * share;
        if (bMay) b[k] += sgn * need * share;
      }
    }
    if (!moved) break;
  }
  return new Map(tags.map((t) => [t.id, { x: t.x, y: t.y, ax: t.ax, ay: t.ay }]));
}
