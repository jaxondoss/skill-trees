/** Per-device look settings (spec v2 r2, 8 and 10): the field's motion and the power-up's volume. */
export type FieldMode = "live" | "calm" | "still";
export type PowerMode = "comic" | "calm";
export const LOOK_EVENT = "forge:look";
const KEY = "forge.look";

export function readLook(): { field: FieldMode; power: PowerMode } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { field?: FieldMode; power?: PowerMode };
    return { field: v.field ?? "live", power: v.power ?? "comic" };
  } catch {
    return { field: "live", power: "comic" };
  }
}

export function saveLook(patch: Partial<{ field: FieldMode; power: PowerMode }>) {
  const next = { ...readLook(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode); the setting then lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(LOOK_EVENT, { detail: next }));
}
