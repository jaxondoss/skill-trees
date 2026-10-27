/**
 * The statue's level (room v3.4). The plaque shows progress from the current level to the next: the overall
 * score's distance above the level, 0..1. The bar follows the score both ways, but the level only rises, and only
 * when the owner presses UPGRADE at 100%. The knight's armour follows the level's tier (I..V at 0, 20, 40, 60, 80).
 */

export const MAX_LEVEL = 100;

/** The level a first visit starts at: the score's whole part. */
export function initialLevel(score: number): number {
  return Math.max(0, Math.min(MAX_LEVEL, Math.floor(score)));
}

/** Progress from the level to the next, 0..1 (1 means UPGRADE is ready). */
export function levelProgress(score: number, level: number): number {
  if (level >= MAX_LEVEL) return 1;
  return Math.max(0, Math.min(1, score - level));
}

/** Whether UPGRADE may raise the level by one. */
export function canUpgrade(score: number, level: number): boolean {
  return level < MAX_LEVEL && score >= level + 1;
}

/** The armour tier (1..5) of a level: it changes only at 20, 40, 60 and 80. */
export function tierOfLevel(level: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(level / 20)));
}
