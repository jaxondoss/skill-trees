import { expect, test, type Page } from "@playwright/test";
import { resetUser, signIn } from "./helpers";
import { openRoom, settled } from "./room-helpers";

// v3.5 room overview (D2-FINAL, PLAN 3.6 step 5; owned by P4, PLAN A11): Up rises to a bird's-eye view of the room
// as it stands; clicking anything there brings you to that item's skill view.
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.setTimeout(180_000);

type Place = { mode: string; view: string; zone: string | null; item: string | null; ret?: Place | null };
type Item = { id: string; view: string; kind: string; of?: string; zone: string; target?: { feature?: string; skill?: string } };
type RoomW = Window & {
  ROOM: {
    nav: { busy: boolean; place: Place; request: (p: Partial<Place>, o?: object) => boolean };
    VIEWS: string[];
    state: Record<string, unknown>;
    art: { items: Item[] };
    itemById: (id: string) => Item;
    variantOf: (it: Item) => string | null;
    zoneOf: (it: Item) => { id: string } | null;
    render: { drawables: Array<{ id: string }>; cssRectOf: (d: unknown) => { left: number; top: number; width: number; height: number } };
  };
};
const place = (page: Page) => page.evaluate(() => (window as unknown as RoomW).ROOM.nav.place);
const twins = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as RoomW).ROOM.art.items.filter((i) => i.view === "top" && i.kind === "hotspot").map((i) => i.of!),
  );

async function rise(page: Page) {
  await page.keyboard.press("ArrowUp");
  await expect(page).toHaveURL(/\/room\/overview$/);
  await settled(page);
  expect((await place(page)).mode).toBe("overview");
}

/** The page-space centre of an overview twin's hit box. */
async function centreOf(page: Page, id: string) {
  return page.evaluate((tid) => {
    const R = (window as unknown as RoomW).ROOM.render;
    const d = R.drawables.find((x) => x.id === tid)!;
    const r = R.cssRectOf(d);
    const c = document.getElementById("room-canvas")!.getBoundingClientRect();
    return { x: c.left + r.left + r.width / 2, y: c.top + r.top + r.height / 2 };
  }, "top." + id);
}

/** Where a skill view for the room item lands (R3: its wall rest, A4: the item's real zone in the URL). */
async function expectSkill(page: Page, id: string) {
  await settled(page);
  const want = await page.evaluate((iid) => {
    const R = (window as unknown as RoomW).ROOM;
    const it = R.itemById(iid);
    return { view: it.view, zone: R.zoneOf(it)!.id, feature: it.target?.feature ?? null };
  }, id);
  const p = await place(page);
  if (want.feature === "calendar") {
    // R23: the study wall calendar leads to the calendar wall, no panel
    expect(p).toMatchObject({ mode: "zone", zone: "calendar" });
    await expect(page).toHaveURL(/\/room\/calendar$/);
    expect(await page.evaluate(() => (window as unknown as RoomW).ROOM.state.panel ?? null)).toBeNull();
    return;
  }
  expect(p, id).toMatchObject({ mode: "skill", item: id, view: want.view });
  await expect(page).toHaveURL(new RegExp(`/room/${want.zone}/${id.split(".").slice(1).join(".")}$`));
}

test.beforeEach(async () => {
  resetUser();
});

test("AC1/AC2: Up rises from every wall and a zone; Down and Esc return to where you were; Back walks out", async ({ page }) => {
  await signIn(page);
  for (const [path, view, zone] of [
    ["/", "front", null],
    ["/room/right", "right", null],
    ["/room/back", "back", null],
    ["/room/left", "left", null],
    ["/room/gym", "right", "gym"],
  ] as const) {
    await openRoom(page, path);
    await settled(page);
    await rise(page);
    expect((await place(page)).ret).toMatchObject({ view, zone });
    await page.keyboard.press(path === "/room/gym" ? "Escape" : "ArrowDown");
    await settled(page);
    expect(await place(page)).toMatchObject({ view, zone });
  }
  // Back from the overview returns to the wall it rose from
  await openRoom(page, "/room/left");
  await settled(page);
  await rise(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/room\/left$/);
  await settled(page);
  expect((await place(page)).mode).toBe("wall");
  expect(await page.evaluate(() => (window as unknown as RoomW).ROOM.VIEWS.length)).toBe(4);
});

test("AC3: every one of the 29 hotspots has a button and a list row, and opens the same skill view", async ({ page }) => {
  await signIn(page);
  await openRoom(page, "/room/overview?motion=0");
  await settled(page);
  const ids = await twins(page);
  expect(ids.length).toBe(29);
  await page.keyboard.press("l");
  for (const id of ids) {
    await expect(page.locator(`.hs[data-id="top.${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#overview-list button[data-of="${id}"]`)).toHaveCount(1);
  }
  for (const id of ids) {
    if ((await place(page)).mode !== "overview") {
      await page.evaluate(() => (window as unknown as RoomW).ROOM.nav.request({ mode: "overview" }, { instant: true }));
      await settled(page);
    }
    await page.locator(`.hs[data-id="top.${id}"]`).dispatchEvent("click");
    await expectSkill(page, id);
  }
});

test("T2: chess, strength, sleep and the wall calendar from the overview, with the real move", async ({ page }) => {
  await signIn(page);
  for (const id of ["library.chess", "gym.strength", "bed.bed", "study.time"]) {
    await openRoom(page, "/room/overview");
    await settled(page);
    await page.locator(`.hs[data-id="top.${id}"]`).dispatchEvent("click");
    await expectSkill(page, id);
    if (id !== "study.time") {
      expect(await page.evaluate(() => Boolean((window as unknown as RoomW).ROOM.state.panel))).toBe(true);
      // closing lands on the item's wall (R3); Back from there returns to the overview (R13)
      await page.keyboard.press("Escape");
      await settled(page);
      expect((await place(page)).mode).toBe("wall");
      await page.goBack();
      await expect(page).toHaveURL(/\/room\/overview$/);
    }
  }
});

test("AC4/AC6: 44 px targets, and every twin shows its room item's live state", async ({ page }) => {
  await signIn(page);
  for (const q of ["", "?night=1"]) {
    await openRoom(page, "/room/overview" + q);
    await settled(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#room-hotspots .hs[data-of]")]
        .filter((b) => b.getBoundingClientRect().width < 44 || b.getBoundingClientRect().height < 44)
        .map((b) => b.dataset.id),
    );
    expect(small).toEqual([]);
    const off = await page.evaluate(() => {
      const R = (window as unknown as RoomW).ROOM;
      return R.art.items
        .filter((i) => i.view === "top" && i.kind === "hotspot")
        .filter((t) => R.variantOf(t) !== R.variantOf(R.itemById(t.of!)))
        .map((t) => t.id);
    });
    expect(off).toEqual([]);
  }
  // the diorama never runs under the title, #nav-up or the plates
  const boxes = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    return { up: r("#nav-up"), list: r("#overview-listbtn"), hint: r("#overview-hint") };
  });
  const top = await page.evaluate(() => {
    const R = (window as unknown as RoomW).ROOM.render as unknown as { restCamera: () => { z: number }; view: { dpr: number } };
    const o = (window as unknown as { ROOM: { overview: { camera: (...a: number[]) => { z: number; ox: number; oy: number } } } }).ROOM.overview.camera(
      1280, 800, 1, R.restCamera().z);
    return { x: -o.ox, y: -o.oy, w: 360 * o.z, h: 300 * o.z };
  });
  for (const b of Object.values(boxes)) {
    if (!b || !b.width) continue;
    const overlap = !(b.right <= top.x || b.left >= top.x + top.w || b.bottom <= top.y || b.top >= top.y + top.h);
    expect(overlap).toBe(false);
  }
});

test("AC9: reduced motion: Up and Down land in the same tick", async ({ page }) => {
  await signIn(page);
  await openRoom(page, "/?motion=0");
  await settled(page);
  const r = await page.evaluate(() => {
    const R = (window as unknown as RoomW).ROOM;
    const ev = (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    ev("ArrowUp");
    const a = { mode: R.nav.place.mode, busy: R.nav.busy };
    ev("ArrowDown");
    const b = { mode: R.nav.place.mode, busy: R.nav.busy };
    return { a, b };
  });
  expect(r.a).toEqual({ mode: "overview", busy: false });
  expect(r.b).toEqual({ mode: "wall", busy: false });
});

test.describe("phone 390x844 @3", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("the whole diorama at 1 CSS px per art px, the list below, no sideways scroll, a tap per item (A3)", async ({ page }) => {
    await signIn(page);
    await openRoom(page, "/room/overview?motion=0");
    await settled(page);
    const list = page.locator("#overview-list");
    await expect(list).toBeVisible();
    const rows = list.locator("button[data-of]");
    expect(await rows.count()).toBe(29);
    const short = await rows.evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height < 44).length);
    expect(short).toBe(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    const z = await page.evaluate(() => (window as unknown as { ROOM: { render: { restCamera: () => { z: number } } } }).ROOM.render.restCamera().z);
    expect(z).toBe(3);
    // a tap on each item's centre opens that item (the nearest centre wins)
    for (const id of await twins(page)) {
      if ((await place(page)).mode !== "overview") {
        await page.evaluate(() => (window as unknown as RoomW).ROOM.nav.request({ mode: "overview" }, { instant: true }));
        await settled(page);
      }
      const c = await centreOf(page, id);
      await page.touchscreen.tap(c.x, c.y);
      await expectSkill(page, id);
    }
    // the list is the precise twin: a row opens its item
    await page.evaluate(() => (window as unknown as RoomW).ROOM.nav.request({ mode: "overview" }, { instant: true }));
    await settled(page);
    await page.locator('#overview-list button[data-of="kitchen.food"]').click();
    await expectSkill(page, "kitchen.food");
  });
});
