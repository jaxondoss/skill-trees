/** A completion sends a pulse of light down its category's energy line into the figure. */
export const PULSE_EVENT = "forge:pulse";

export function emitPulse(categoryId: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PULSE_EVENT, { detail: { categoryId } }));
}
