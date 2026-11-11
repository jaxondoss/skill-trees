import { expect, test, type Page } from "@playwright/test";
import { resetUser, signIn } from "./helpers";
import { openRoom, pinGl, settled } from "./room-helpers";

// v3.5 room skill view (D1-FINAL, PLAN 3.5 step 7; owned by P3 per A11). The item lifts out of the room you face
// without a camera move and floats, lit, left of the board (laptop) or above the 58svh sheet (phone).
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.setTimeout(120_000);

type Rect = { x: number; y: number; w: number; h: number };
type SkillDbg = { id: string; phase: string; open: boolean; rectDev: Rect; k: number; heroK: number; selK: number };
type RoomW = Window & {
  ROOM: {
    nav: { busy: boolean; place: { mode: string; view: string; zone: string | null; item: string | null }; skillPlaceOf: (id: string, from?: unknown) => { mode: string } | null };
    skill: { open: (id: string, o?: object) => boolean; close: (o?: object) => boolean; rectCss: () => { left: number; top: number; right: number; bottom: number; width: number; height: number } | null };
    state: Record<string, unknown>;
    art: { items: { id: string; kind: string; view: string; of?: string; target?: { feature?: string } }[] };
    render: { view: { dpr: number } };
    debug: { freeze: () => void; thaw: () => void; advance: (ms: number) => void; readFrame: () => ImageData; state: { camera: unknown; skill: SkillDbg | null } };
  };
};

const skill = (page: Page) => page.evaluate(() => (window as unknown as RoomW).ROOM.debug.state.skill);
const camera = (page: Page) => page.evaluate(() => JSON.stringify((window as unknown as RoomW).ROOM.debug.state.camera));

/** Hero rect in CSS px (viewport) and the board's box. */
async function geometry(page: Page) {
  const hero = await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.rectCss());
  const board = await page.locator(".ui-panel").boundingBox();
  return { hero, board };
}

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("D1 AC1/AC7/AC8: same-wall open keeps the camera, k steps up in whole device px, hero left of the board", async ({ page }) => {
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  const cam0 = await camera(page);
  // the bookcase on the front wall: one click, no dolly (R1)
  await page.evaluate(() => (window as unknown as RoomW).ROOM.debug.freeze());
  // a double-click opens the skill view (a single click opens the hologram, room-holo.spec.ts)
  await page.locator('.hs[data-id="library.bookshelf"]').dblclick({ force: true });
  await expect(page).toHaveURL(/\/room\/library\/bookshelf(\?|$)/);
  const frames: SkillDbg[] = [];
  for (let t = 0; t < 12; t++) {
    await page.evaluate(() => (window as unknown as RoomW).ROOM.debug.advance(40));
    expect(await camera(page)).toBe(cam0);
    const s = await skill(page);
    if (s) frames.push(s);
  }
  expect(frames.length).toBeGreaterThan(5);
  for (let i = 0; i < frames.length; i++) {
    const r = frames[i]!.rectDev;
    for (const v of [r.x, r.y, r.w, r.h, frames[i]!.k]) expect(Number.isInteger(v)).toBe(true);
    if (i) expect(frames[i]!.k).toBeGreaterThanOrEqual(frames[i - 1]!.k);
  }
  const last = frames[frames.length - 1]!;
  expect(last.phase).toBe("shown");
  // the atlas starts one texel up-left of the sprite; the sprite sits on a multiple of k
  expect((last.rectDev.x + last.k) % last.k).toBe(0);
  expect((last.rectDev.y + last.k) % last.k).toBe(0);
  const panel = page.locator(".ui-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/side-right/);
  await expect(panel).toHaveClass(/has-hero/);
  await expect(page.locator("#ui-root")).toHaveClass(/skill-open/);
  const { hero, board } = await geometry(page);
  expect(hero!.right).toBeLessThanOrEqual(board!.x - 12);
  expect(hero!.left).toBeGreaterThanOrEqual(0);
  expect(hero!.bottom).toBeLessThanOrEqual(900);
  // close: Esc, the camera never moved, the URL is the wall again, the hero is gone
  await page.keyboard.press("Escape");
  for (let t = 0; t < 12; t++) {
    await page.evaluate(() => (window as unknown as RoomW).ROOM.debug.advance(40));
    expect(await camera(page)).toBe(cam0);
  }
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/localhost:3200\/(\?|$)/);
  expect(await skill(page)).toBeNull();
  await page.evaluate(() => (window as unknown as RoomW).ROOM.debug.thaw());
});

test("D1 AC8: 1366x768, every board hotspot: board right, hero clear of it and on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  const ids = await page.evaluate(() => {
    const R = (window as unknown as RoomW).ROOM;
    return R.art.items
      .filter((it) => it.kind === "hotspot" && !it.of && it.target && it.view !== "top")
      .filter((it) => {
        const p = R.nav.skillPlaceOf(it.id);
        return p && p.mode === "skill";
      })
      .map((it) => it.id);
  });
  expect(ids.length).toBeGreaterThanOrEqual(20);
  const bad: string[] = [];
  for (const id of ids) {
    await page.evaluate((i) => (window as unknown as RoomW).ROOM.skill.open(i, { source: "board" }), id);
    await settled(page);
    const s = await skill(page);
    const panel = page.locator(".ui-panel");
    const visible = await panel.isVisible();
    const { hero, board } = await geometry(page);
    const cls = (await panel.getAttribute("class")) ?? "";
    if (!s || s.phase !== "shown" || !hero || (visible && (!board || hero.right > board.x - 12 || !cls.includes("side-right")))) bad.push(id);
    else if (hero.left < 0 || hero.top < 0 || hero.bottom > 768) bad.push(id + " off-screen");
    await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.close({ instant: true }));
    await settled(page);
  }
  expect(bad).toEqual([]);
});

test("D1 AC10: reduced motion: open and close are one frame each", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  const step = (src: string) =>
    page.evaluate((src) => {
      const R = (window as unknown as RoomW).ROOM;
      R.debug.freeze();
      new Function(src)();
      R.debug.advance(16);
      const a = R.debug.readFrame().data;
      const s = R.debug.state.skill;
      R.debug.advance(784);
      const b = R.debug.readFrame().data;
      const W = R.debug.readFrame().width;
      // after a close, focus is back on the hotspot: its legacy focus glow (removed at I7) animates; skip its box
      const hr = (R as unknown as { itemRectCss: (id: string) => { left: number; top: number; right: number; bottom: number } | null }).itemRectCss("library.bookshelf");
      const d = R.render.view.dpr, pad = 24;
      let diff = 0, n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const x = (i / 4) % W, y = Math.floor(i / 4 / W);
        if (!s && hr && x >= (hr.left - pad) * d && x < (hr.right + pad) * d && y >= (hr.top - pad) * d && y < (hr.bottom + pad) * d) continue;
        diff += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
        n++;
      }
      return { mean: diff / Math.max(1, n) / 3, phase: s && s.phase, busy: R.nav.busy };
    }, src);
  const o = await step("ROOM.skill.open('library.bookshelf')");
  expect(o.phase).toBe("shown");
  expect(o.busy).toBe(false);
  // the frame at 16 ms equals the one at 800 ms, up to grain (frozen clock: grain is frozen too)
  expect(o.mean).toBeLessThan(0.5);
  const c = await step("ROOM.skill.close()");
  expect(c.phase ?? null).toBeNull();
  expect(c.mean).toBeLessThan(0.5);
});

test("D1 AC11: keyboard: Shift+Enter opens, focus in the board, one Esc closes and restores focus; Back does not reopen; deep link", async ({ page }) => {
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  const hs = page.locator('.hs[data-id="library.bookshelf"]');
  await hs.focus();
  // Enter opens the hologram; Shift+Enter the skill view
  await page.keyboard.press("Shift+Enter");
  const panel = page.locator(".ui-panel");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/room\/library\/bookshelf(\?|$)/);
  await settled(page);
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(panel).toHaveAttribute("aria-label", /Reading/i);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await settled(page);
  await expect(page).toHaveURL(/localhost:3200\/(\?|$)/);
  await expect(hs).toBeFocused();
  // Back after a close leaves the room, never into the board again
  await page.goBack();
  await page.waitForTimeout(300);
  await expect(panel).toBeHidden();
  // deep link boots straight into the skill view: hero up, board open, dim on
  await openRoom(page, pinGl("/room/library/bookshelf", "low"));
  await settled(page);
  await expect(panel).toBeVisible();
  const s = await skill(page);
  expect(s?.id).toBe("library.bookshelf");
  expect(s?.phase).toBe("shown");
});

test("the hero rect swallows presses; outside it the scrim closes; board links lift another item", async ({ page }) => {
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.open("library.bookshelf"));
  await settled(page);
  const panel = page.locator(".ui-panel");
  await expect(panel).toBeVisible();
  const { hero } = await geometry(page);
  await page.mouse.click(hero!.left + hero!.width / 2, hero!.top + hero!.height / 2);
  await page.waitForTimeout(200);
  await expect(panel).toBeVisible();
  // a press on the dimmed room outside the hero closes (DROP)
  await page.mouse.click(hero!.left + 4, 760);
  await expect(panel).toBeHidden();
  await settled(page);
  expect(await skill(page)).toBeNull();
  // the statue board opens a skill view for the statue too (relic mounts and features count, R23)
  await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.open("window.statue"));
  await settled(page);
  await expect(panel).toBeVisible();
  expect((await skill(page))?.id).toBe("window.statue");
});

test("flows: relic mount board, study wall calendar leads to the calendar zone with no hero", async ({ page }) => {
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.open("window.relic"));
  await settled(page);
  await expect(page.locator(".ui-panel")).toBeVisible();
  expect((await skill(page))?.id).toBe("window.relic");
  await page.keyboard.press("Escape");
  await settled(page);
  await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.open("study.time"));
  await settled(page);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as RoomW).ROOM.nav.place)).zone).toBe("calendar");
  expect(await skill(page)).toBeNull();
  await expect(page.locator(".ui-panel")).toBeHidden();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  test("D1 AC8 phone: the hero floats above the 58svh sheet, 64 css tall at least, no horizontal scroll", async ({ page }) => {
    await openRoom(page, pinGl("/", "low"));
    await settled(page);
    await page.evaluate(() => (window as unknown as RoomW).ROOM.skill.open("library.bookshelf"));
    await settled(page);
    const panel = page.locator(".ui-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-sheet/);
    await expect(panel).toHaveClass(/has-hero/);
    const { hero, board } = await geometry(page);
    expect(hero!.bottom).toBeLessThanOrEqual(board!.y - 8 + 0.5);
    expect(hero!.height).toBeGreaterThanOrEqual(64);
    expect(hero!.top).toBeGreaterThanOrEqual(92 - 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // sheet controls are 44 css on touch
    const close = await panel.locator('[data-k="close"]').boundingBox();
    expect(close!.height).toBeGreaterThanOrEqual(44);
    expect(close!.width).toBeGreaterThanOrEqual(44);
  });
});

// D1 AC12 needs the overview (P4): overview -> skill and wall -> skill land identically.
test.fixme("D1 AC12: overview and wall land the same skill view (library.bookshelf, gym.strength, bed.bed)", async () => {});
