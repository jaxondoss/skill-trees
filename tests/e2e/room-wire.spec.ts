import { expect, test, type Page } from "@playwright/test";
import { resetUser, signIn } from "./helpers";
import { openRoom, pinGl, settled } from "./room-helpers";

// v3.5 room skill wires (D3-FINAL, PLAN 3.7 and A2/A7): owned by P5 (PLAN A11). Pixel-level acceptance lives in
// scripts/room-v35-wire.mjs (file:// prototype, pinned tier); these check the wires in the app.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.setTimeout(120_000);

type Style = { kind: string; line: number; node: number | null; bit4: boolean; dash: boolean; state?: string | null };
type WireRoom = {
  wire: { active: boolean; styleOf(id: string): Style | null; data(id: string): { hull: number[] } | null };
  markStateOf(slug: string): string | null;
  render: {
    drawables: { id: string; hotspot: boolean; skill: { slug: string; status: string } | null; item: { target?: object } }[];
  };
  debug: { freeze(): void; advance(ms: number): void; readFrame(): ImageData };
  state: Record<string, unknown>;
  invalidate(): void;
};
const R = "window.ROOM";

/** id -> style kind (null = no mark) for every hotspot drawn on the current wall. */
async function kinds(page: Page) {
  return page.evaluate(() => {
    const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
    const out: Record<string, string | null> = {};
    for (const d of ROOM.render.drawables) {
      if (!d.hotspot) continue;
      const s = ROOM.wire.styleOf(d.id);
      out[d.id] = s ? s.kind : null;
    }
    return out;
  });
}
async function activeSkills(page: Page) {
  return page.evaluate(() => {
    const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
    return ROOM.render.drawables.filter((d) => d.hotspot && d.skill && d.skill.status === "active").map((d) => d.id);
  });
}

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("at rest every active skill carries a wire and no cage; features carry none", async ({ page }) => {
  for (const path of ["/", "/room/right", "/room/left"]) {
    await openRoom(page, pinGl(path));
    await settled(page);
    expect(await page.evaluate(`${R}.wire.active`)).toBe(true);
    const k = await kinds(page);
    const skills = await activeSkills(page);
    expect(skills.length).toBeGreaterThan(0);
    for (const id of skills) expect(k[id], `${path} ${id}`).toBe("wire");
    expect(Object.values(k).filter((v) => v === "cage")).toHaveLength(0);
    const features = await page.evaluate(() => {
      const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
      return ROOM.render.drawables.filter((d) => d.hotspot && !d.skill && d.item.target).map((d) => d.id);
    });
    for (const id of features) expect(k[id], `${path} ${id}`).toBeNull();
  }
  // one mark state per active skill, from the same source as the LEDs
  const states = await page.evaluate(() => {
    const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
    return [...new Set(ROOM.render.drawables.filter((d) => d.skill).map((d) => ROOM.markStateOf(d.skill!.slug)))];
  });
  for (const s of states) expect(["off", "pending", "top", "half", "full", "neglect", null]).toContain(s);
});

test("hover shows one cage (gate pass) or hot wire (gate fail); Shift marks every skill", async ({ page }) => {
  await openRoom(page, pinGl("/room/right"));
  await settled(page);
  const board = page.locator('.hs[data-id="computer.board"]');
  await board.hover();
  await expect.poll(async () => (await kinds(page))["computer.board"]).toBe("cage");
  let k = await kinds(page);
  expect(Object.entries(k).filter(([, v]) => v === "cage" || v === "hot")).toHaveLength(1);
  // the bike's box fails the gate: hot wire instead
  await page.locator('.hs[data-id="gym.bike"]').hover();
  await expect.poll(async () => (await kinds(page))["gym.bike"]).toBe("hot");
  expect((await kinds(page))["computer.board"]).toBe("wire");
  await page.mouse.move(2, 450);
  await expect.poll(async () => Object.values(await kinds(page)).filter((v) => v === "hot" || v === "cage").length).toBe(0);
  // Shift inspect (hold)
  await page.keyboard.down("Shift");
  await expect.poll(() => page.evaluate(`${R}.state.inspect`), { timeout: 5000 }).toBe(true);
  k = await kinds(page);
  for (const id of await activeSkills(page)) expect(["cage", "hot"]).toContain(k[id]);
  await page.keyboard.up("Shift");
});

test("keyboard focus shows the attention mark; hotspot buttons do not move with the wires", async ({ page }) => {
  await openRoom(page, pinGl("/room/right"));
  await settled(page);
  const rects = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".hs")]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return [b.dataset.id, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(",");
        })
        .sort()
        .join(";"),
    );
  const on = await rects();
  await page.evaluate(() => {
    const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
    ROOM.wire.active = false;
    ROOM.invalidate();
  });
  await page.waitForTimeout(200);
  expect(await rects()).toBe(on);
  await page.evaluate(() => {
    const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
    ROOM.wire.active = true;
    ROOM.invalidate();
  });
  await page.locator('.hs[data-id="study.academics"]').focus();
  await expect.poll(async () => (await kinds(page))["study.academics"]).toBe("cage");
});

test("reduced motion: the rest frame with wires is static, also after a hover settles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoom(page, pinGl("/"));
  await settled(page);
  const still = () =>
    page.evaluate(() => {
      const ROOM = (window as unknown as { ROOM: WireRoom }).ROOM;
      ROOM.debug.freeze();
      ROOM.debug.advance(16);
      const a = ROOM.debug.readFrame().data;
      ROOM.debug.advance(3200); // whole LED blink periods (800 ms): only the wires could differ
      const b = ROOM.debug.readFrame().data;
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    });
  expect(await still()).toBe(0);
  await page.locator('.hs[data-id="library.chess"]').hover();
  await expect.poll(async () => (await kinds(page))["library.chess"]).toBe("hot");
  expect(await still()).toBe(0);
});
