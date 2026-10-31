import type { Page } from "@playwright/test";

/** Shared helpers for the room specs (v3.5 seams; room.spec.ts, room-skill, room-overview, room-wire). */

type RoomWindow = Window & {
  ROOM?: { debug?: unknown; nav?: { busy: boolean }; state: Record<string, unknown> };
};

/** Load the room at path and wait for the engine to boot. */
export async function openRoom(page: Page, path = "/") {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((window as RoomWindow).ROOM?.debug));
}

/** Hotspots are switched off while the camera moves; wait until the navigator is idle. */
export const settled = (page: Page) =>
  page.waitForFunction(() => {
    const nav = (window as RoomWindow).ROOM?.nav;
    return Boolean(nav) && !nav!.busy;
  });

export const roomState = (page: Page) => page.evaluate(() => (window as RoomWindow).ROOM!.state);

/**
 * Pin the GPU path for pixel checks: a fixed GPU tier (?gltier= also stops the auto tier)
 * and clear weather. Adds to any existing query.
 */
export function pinGl(url: string, tier: "high" | "low" = "high") {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}gltier=${tier}&weather=clear`;
}
