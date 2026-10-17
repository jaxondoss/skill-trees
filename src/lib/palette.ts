/**
 * Category colour by slug (spec v2 r2, 8). The stored `categories.color` is the old tint; the board uses the
 * tuned trio through the `c-<slug>` class so chart order and contrast stay validated.
 */
export const CATEGORY_ORDER = ["business", "school", "athletics", "mind", "nutrition"] as const;
export type CategorySlug = (typeof CATEGORY_ORDER)[number];

export const MARK: Record<CategorySlug, string> = {
  business: "#c8850e",
  school: "#4676f2",
  athletics: "#e3464b",
  mind: "#a966e5",
  nutrition: "#00a75d",
};

export function isCategorySlug(s: string | null | undefined): s is CategorySlug {
  return !!s && (CATEGORY_ORDER as readonly string[]).includes(s);
}

/** The class that sets --c, --ct and --tint for a category; gold for anything else. */
export function catClass(slug: string | null | undefined): string {
  return isCategorySlug(slug) ? `c-${slug}` : "c-gold";
}

/** Completion ramp: one cool hue that brightens with effort (spec v2 8.1). */
export function rampColor(p: number | null): string | null {
  if (p === null) return null;
  const pct = p <= 1 ? p * 100 : p;
  if (pct >= 85) return "var(--r5)";
  if (pct >= 70) return "var(--r4)";
  if (pct >= 50) return "var(--r3)";
  if (pct >= 25) return "var(--r2)";
  if (pct > 0) return "var(--r1)";
  return "var(--r0)";
}
