import { expect, test, type Page } from "@playwright/test";
import { resetUser, signIn } from "./helpers";
import { openRoom, pinGl, settled } from "./room-helpers";

// The skill hologram (engine/holo.js; SKILL_TREE_HOLO.md, review round 3): a single click or Enter on a skill object
// lifts it to the centre with three holo nodes around it; a double-click or Shift+Enter (or OPEN SKILL) opens the
// skill view; Esc, a click on the room, or Back closes. Features keep their own behaviour.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.setTimeout(120_000);

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type HoloW = Window & {
  __logs: unknown[];
  ROOM: {
    nav: { busy: boolean; place: { mode: string; item: string | null; holo?: boolean }; request: (p: object, o?: object) => boolean };
    holo: { isOpen: () => boolean; current: () => { id: string; skills: string[] } | null };
    skill: { rectCss: () => Box | null };
    state: Record<string, unknown>;
    data: { goals: { id: string; skill: string; result: string | null }[] };
    itemsForSkill: (slug: string) => { id: string }[];
    on: (n: string, fn: (d: unknown) => void) => void;
  };
};
const holoOpen = (page: Page) => page.evaluate(() => (window as unknown as HoloW).ROOM.holo.isOpen());
const place = (page: Page) => page.evaluate(() => (window as unknown as HoloW).ROOM.nav.place);
const hero = (page: Page) => page.evaluate(() => (window as unknown as HoloW).ROOM.skill.rectCss());
const panels = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#room-holo .hl-panel")].map((p) => {
      const r = p.getBoundingClientRect();
      return { skill: p.dataset.skill!, kind: p.dataset.kind!, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
    }),
  );
const overlaps = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
async function openHolo(page: Page, id: string) {
  await page.evaluate((iid) => (window as unknown as HoloW).ROOM.nav.request({ mode: "skill", item: iid, holo: true }, { source: "click" }), id);
  await settled(page);
  await expect.poll(() => holoOpen(page)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("a click opens the hologram: object centred and never covered, three nodes, Esc and Back close", async ({ page }) => {
  await openRoom(page, pinGl("/room/right", "low"));
  await settled(page);
  await page.locator('.hs[data-id="gym.strength"]').click({ force: true });
  await settled(page);
  expect(await holoOpen(page)).toBe(true);
  expect(await place(page)).toMatchObject({ mode: "skill", item: "gym.strength", holo: true });
  await expect(page).toHaveURL(/\/room\/gym\/strength(\?|$)/);
  await expect(page.locator(".ui-panel")).toBeHidden();
  const h = (await hero(page))!;
  expect(Math.abs((h.left + h.right) / 2 - 720)).toBeLessThan(60);
  const ps = await panels(page);
  expect(ps.map((p) => p.kind).sort()).toEqual(["graph", "today", "visual"]);
  for (const p of ps) expect(overlaps(p, h), p.kind).toBe(false);
  await expect(page.getByRole("dialog", { name: /strength hologram/i })).toBeVisible();
  // Esc closes back to the wall
  await page.keyboard.press("Escape");
  await settled(page);
  expect(await holoOpen(page)).toBe(false);
  expect((await place(page)).mode).toBe("wall");
  // Back (Android) closes an open hologram
  await openRoom(page, pinGl("/room/right", "low"));
  await settled(page);
  await page.locator('.hs[data-id="gym.strength"]').click({ force: true });
  await settled(page);
  expect(await holoOpen(page)).toBe(true);
  await page.goBack();
  await settled(page);
  expect(await holoOpen(page)).toBe(false);
  expect((await place(page)).mode).not.toBe("skill");
});

test("double-click and Shift+Enter open the skill view; OPEN SKILL converts in place; a click on the room closes", async ({ page }) => {
  await openRoom(page, pinGl("/room/right", "low"));
  await settled(page);
  const hs = page.locator('.hs[data-id="gym.strength"]');
  await hs.dblclick({ force: true });
  await settled(page);
  await expect(page.locator(".ui-panel")).toBeVisible();
  expect(await holoOpen(page)).toBe(false);
  await page.keyboard.press("Escape");
  await settled(page);
  await hs.focus();
  await page.keyboard.press("Shift+Enter");
  await settled(page);
  await expect(page.locator(".ui-panel")).toBeVisible();
  expect(await holoOpen(page)).toBe(false);
  await page.keyboard.press("Escape");
  await settled(page);
  // Enter opens the hologram; focus moves to OPEN SKILL
  await hs.focus();
  await page.keyboard.press("Enter");
  await settled(page);
  expect(await holoOpen(page)).toBe(true);
  const open = page.locator("#room-holo .hl-open");
  await expect(open).toBeFocused();
  const len = await page.evaluate(() => history.length);
  await open.click();
  await settled(page);
  await expect(page.locator(".ui-panel")).toBeVisible();
  expect(await holoOpen(page)).toBe(false);
  expect(await page.evaluate(() => history.length)).toBe(len);
  await expect(page).toHaveURL(/\/room\/gym\/strength(\?|$)/);
  await page.keyboard.press("Escape");
  await settled(page);
  // a click on the dimmed room outside the object and the nodes closes
  await openHolo(page, "gym.strength");
  const pt = await page.evaluate(() => {
    const R = (window as unknown as HoloW).ROOM;
    const h = R.skill.rectCss()!;
    for (let y = 120; y < innerHeight - 60; y += 20)
      for (let x = 80; x < innerWidth - 80; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el && el.id === "room-canvas" && !(x >= h.left && x < h.right && y >= h.top && y < h.bottom)) return { x, y };
      }
    return null;
  });
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await settled(page);
  expect(await holoOpen(page)).toBe(false);
  // features keep their behaviour: the statue opens its board straight away
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  await page.locator('.hs[data-id="window.statue"]').click({ force: true });
  await settled(page);
  await expect(page.locator(".ui-panel")).toBeVisible();
  expect(await holoOpen(page)).toBe(false);
});

test("DAY / WEEK toggle, and a check in Today's actions logs through the room's log event", async ({ page }) => {
  await openRoom(page, pinGl("/", "low"));
  await settled(page);
  const goal = await page.evaluate(() => {
    const R = (window as unknown as HoloW).ROOM;
    (window as unknown as HoloW).__logs = [];
    R.on("log", (d) => (window as unknown as HoloW).__logs.push(d));
    const g = R.data.goals.find((x) => !x.result && R.itemsForSkill(x.skill).length);
    return g ? { id: g.id, skill: g.skill, item: R.itemsForSkill(g.skill)[0]!.id } : null;
  });
  expect(goal, "an open goal on today's plan").not.toBeNull();
  await openHolo(page, goal!.item);
  const graph = page.locator(`#room-holo .hl-graph[data-skill="${goal!.skill}"]`);
  const day = graph.getByRole("button", { name: "DAY" });
  await day.click();
  await expect(graph.getByRole("button", { name: "DAY" })).toHaveAttribute("aria-pressed", "true");
  await expect(graph.getByRole("button", { name: "WEEK" })).toHaveAttribute("aria-pressed", "false");
  await graph.getByRole("button", { name: "WEEK" }).click();
  await expect(graph.getByRole("button", { name: "WEEK" })).toHaveAttribute("aria-pressed", "true");
  const row = page.locator(`#room-holo .hl-today[data-skill="${goal!.skill}"] .hl-act[data-tier="standard"]`);
  await expect(row).toHaveAttribute("aria-checked", "false");
  await row.click();
  await expect(page.locator(`#room-holo .hl-today[data-skill="${goal!.skill}"] .hl-act[data-tier="standard"]`)).toHaveAttribute("aria-checked", "true");
  const after = await page.evaluate((gid) => {
    const W = window as unknown as HoloW;
    return { logs: W.__logs, result: W.ROOM.data.goals.find((x) => x.id === gid)!.result };
  }, goal!.id);
  expect(after.result).toBe("standard");
  expect(after.logs).toContainEqual({ goalId: goal!.id, result: "standard" });
  expect(await holoOpen(page)).toBe(true);
});

test("the computer holds two skills: one centre, each skill's nodes on its own side", async ({ page }) => {
  await openRoom(page, pinGl("/room/right", "low"));
  await settled(page);
  await openHolo(page, "computer.ai");
  expect((await page.evaluate(() => (window as unknown as HoloW).ROOM.holo.current()))!.skills).toEqual(["ai-building", "dropshipping"]);
  const h = (await hero(page))!;
  const ps = await panels(page);
  expect(ps.filter((p) => p.skill === "ai-building")).toHaveLength(3);
  expect(ps.filter((p) => p.skill === "dropshipping")).toHaveLength(3);
  for (const p of ps) {
    if (p.skill === "ai-building") expect(p.right).toBeLessThanOrEqual(h.left);
    else expect(p.left).toBeGreaterThanOrEqual(h.right);
  }
  await expect(page.locator("#room-holo .hl-open")).toHaveCount(2);
});

test("reduced motion: the final state at once", async ({ page }) => {
  await openRoom(page, pinGl("/room/right?motion=0", "low"));
  await settled(page);
  await page.locator('.hs[data-id="gym.strength"]').click({ force: true });
  expect(await holoOpen(page)).toBe(true);
  await expect(page.locator("#room-holo")).toHaveClass(/instant/);
  expect(await page.evaluate(() => (window as unknown as HoloW).ROOM.nav.busy)).toBe(false);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  test("the nodes stack and scroll under the object; 44 px targets; no sideways scroll", async ({ page }) => {
    await openRoom(page, pinGl("/room/right", "low"));
    await settled(page);
    await openHolo(page, "gym.strength");
    await expect(page.locator("#room-holo")).toHaveClass(/phone/);
    const h = (await hero(page))!;
    const ps = await panels(page);
    expect(ps).toHaveLength(3);
    for (const p of ps) {
      expect(p.top).toBeGreaterThanOrEqual(h.bottom);
      expect(p.width).toBeGreaterThanOrEqual(300);
    }
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#room-holo button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length,
    );
    expect(small).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
