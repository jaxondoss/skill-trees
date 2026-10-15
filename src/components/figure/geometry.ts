/**
 * Procedural figure art (spec 5.3 fallback): a stone silhouette in the stage's 100 x 130
 * coordinate space, five region masks, and seeded gold kintsugi veins per region.
 * Pure and deterministic, so server and client render identical markup.
 */

/** Mirrors absolute "x y" pairs across x = 50 (paths here use only absolute M, L, C, Z). */
export function mirror(path: string): string {
  return path.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${+(100 - Number(x)).toFixed(2)} ${y}`);
}

const LEFT_ARM =
  "M39.6 43.2 C38 44.2 37.2 46.5 37 49.5 C36.6 53.5 36 57.5 36.2 61 C36 65 35.4 70 35.4 74.5 C35.2 77 35 79.5 35.6 81.6 C36.2 82.6 37.4 82.4 37.6 81 C37.8 79 37.8 77 38 74.5 C38.5 70 39 65.5 39.4 61.5 C39.8 58 40.6 53 41.2 49.8 Z";
const LEFT_LEG =
  "M42.6 76.5 L49.6 76.5 C49.7 82 49.4 90 48.9 99 C49.2 104 48.8 110 48.2 116 C48 119 47.9 121 48.1 123 L48.8 125.6 C48.8 126.4 48 126.8 47 126.8 L44.4 126.8 C43.6 126.8 43.4 126 43.8 125 L45.2 122.6 C45 119 44.6 115 44.4 110 C44 104.5 43.8 101 44 99 C43 92 42.4 84 42.6 76.5 Z";

export const BODY = {
  head: "M50 25.6 C53 25.6 54.4 28 54.3 31 C54.2 34 52.6 36.6 50 36.8 C47.4 36.6 45.8 34 45.7 31 C45.6 28 47 25.6 50 25.6 Z",
  neck: "M48 35.8 L52 35.8 L52.6 40.6 L47.4 40.6 Z",
  chest:
    "M47.4 40.3 C44 40.8 41 41.5 39.6 43.2 C38.9 45 39.2 47.5 40.2 49.5 L41.4 58 L58.6 58 L59.8 49.5 C60.8 47.5 61.1 45 60.4 43.2 C59 41.5 56 40.8 52.6 40.3 Z",
  /** Chest and core as one shape, so the stone base has no seam at the waist. */
  torso:
    "M47.4 40.3 C44 40.8 41 41.5 39.6 43.2 C38.9 45 39.2 47.5 40.2 49.5 L41.4 58 C41.6 62 42.4 66 43 70 C43.2 72.5 42.8 74.5 42.6 76.5 L57.4 76.5 C57.2 74.5 56.8 72.5 57 70 C57.6 66 58.4 62 58.6 58 L59.8 49.5 C60.8 47.5 61.1 45 60.4 43.2 C59 41.5 56 40.8 52.6 40.3 Z",
  core: "M41.4 58 L58.6 58 C58.4 62 57.6 66 57 70 C56.8 72.5 57.2 74.5 57.4 76.5 L42.6 76.5 C42.8 74.5 43.2 72.5 43 70 C42.4 66 41.6 62 41.4 58 Z",
  leftArm: LEFT_ARM,
  rightArm: mirror(LEFT_ARM),
  leftLeg: LEFT_LEG,
  rightLeg: mirror(LEFT_LEG),
} as const;

export type Region = "head" | "left_arm" | "right_arm" | "left_leg_core" | "right_leg_chest";

/** Body parts that make up each category's region (spec 3 and 5.3). */
export const REGION_PARTS: Record<Region, string[]> = {
  head: [BODY.head, BODY.neck],
  left_arm: [BODY.leftArm],
  right_arm: [BODY.rightArm],
  left_leg_core: [BODY.leftLeg, BODY.core],
  right_leg_chest: [BODY.rightLeg, BODY.chest],
};

type Box = { x0: number; x1: number; y0: number; y1: number };
const REGION_BOXES: Record<Region, Box[]> = {
  head: [{ x0: 45.6, x1: 54.4, y0: 25.6, y1: 40.6 }],
  left_arm: [{ x0: 35, x1: 41.3, y0: 43, y1: 83 }],
  right_arm: [{ x0: 58.7, x1: 65, y0: 43, y1: 83 }],
  left_leg_core: [
    { x0: 41.4, x1: 58.6, y0: 58, y1: 76.5 },
    { x0: 42.4, x1: 49.7, y0: 76.5, y1: 127 },
  ],
  right_leg_chest: [
    { x0: 39.2, x1: 60.8, y0: 40.3, y1: 58 },
    { x0: 50.3, x1: 57.6, y0: 76.5, y1: 127 },
  ],
};
const TRUNKS: Record<Region, number> = { head: 4, left_arm: 6, right_arm: 6, left_leg_core: 12, right_leg_chest: 12 };

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Vein = { d: string; width: number; length: number };

/**
 * Kintsugi cracks for one region: random walks that wander mostly along the limb,
 * branching now and then. Ordered trunk-first, so showing the first N gives a natural spread.
 */
export function regionVeins(region: Region, seed = 7): Vein[] {
  const rand = rng(seed * 31 + region.length * 977 + region.charCodeAt(0) * 13);
  const veins: Vein[] = [];
  const walk = (x: number, y: number, angle: number, steps: number, width: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    let length = 0;
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 1.1;
      const step = 0.9 + rand() * 1.4;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      length += step;
      pts.push([x, y]);
      if (depth < 2 && rand() < 0.16) walk(x, y, angle + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.6), Math.ceil(steps / 2), width * 0.6, depth + 1);
    }
    veins.push({ d: "M" + pts.map(([px, py]) => `${px.toFixed(2)} ${py.toFixed(2)}`).join(" L"), width, length });
  };

  const boxes = REGION_BOXES[region];
  for (let t = 0; t < TRUNKS[region]; t++) {
    const box = boxes[t % boxes.length]!;
    const x = box.x0 + rand() * (box.x1 - box.x0);
    const y = box.y0 + rand() * (box.y1 - box.y0);
    const vertical = (box.y1 - box.y0) > (box.x1 - box.x0) * 1.5;
    const angle = vertical ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 0.6 : rand() * Math.PI * 2;
    walk(x, y, angle, 7 + Math.floor(rand() * 8), 0.38, 0);
  }
  // Trunks were pushed after their branches; put the widest (trunk) veins first.
  return veins.sort((a, b) => b.width - a.width);
}

/** Share of each region's veins visible at a figure tier (spec 5.2: from first thin veins to mostly luminous). */
export const VEIN_SHARE: Record<number, number> = { 1: 0.07, 2: 0.32, 3: 0.6, 4: 0.85, 5: 1 };

export function visibleVeins(region: Region, tier: number): Vein[] {
  const all = regionVeins(region);
  return all.slice(0, Math.max(1, Math.ceil(all.length * (VEIN_SHARE[tier] ?? 0.12))));
}
