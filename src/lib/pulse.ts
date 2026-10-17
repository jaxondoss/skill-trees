/** A completion sends light from the control you touched into the statue (the power-up, spec v2 r2, 10). */
export const PULSE_EVENT = "forge:pulse";
/** The field rings out from a point when the light lands. */
export const FIELD_BURST_EVENT = "forge:field-burst";

export type PulseDetail = {
  categoryId: string;
  /** Category slug, for colour. */
  category?: string;
  /** Points added, shown in the comic caption. */
  gain?: number;
  /** Where the light starts: the centre of the control that was tapped. */
  from?: { x: number; y: number };
  /** The skill whose tile flares. */
  skillId?: string;
};
export type FieldBurst = { x: number; y: number; category: string };

export function emitPulse(categoryId: string, extra: Omit<PulseDetail, "categoryId"> = {}) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<PulseDetail>(PULSE_EVENT, { detail: { categoryId, ...extra } }));
}

export function emitBurst(detail: FieldBurst) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<FieldBurst>(FIELD_BURST_EVENT, { detail }));
}

/** The centre of an element, for `from`. */
export function centerOf(el: Element | null | undefined): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
