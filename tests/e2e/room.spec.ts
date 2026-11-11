import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { openRoom, roomState, settled } from "./room-helpers";
import { USER_ID } from "./stack/config.mjs";

// The v3 room at / (spec docs/SPEC-v3-room.md), on a laptop screen.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const ZONES = ["kitchen", "bed", "library", "window", "study", "computer", "gym"];

type Nav = {
  busy: boolean;
  place: { mode: string; view: string; zone: string | null; item: string | null };
  overviewOn: () => boolean;
};
type RoomW = Window & { ROOM: { nav: Nav; state: Record<string, unknown>; debug: { freeze: () => void; advance: (ms: number) => void; readFrame: () => ImageData } } };
const place = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as RoomW).ROOM.nav.place);


test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("the room loads at /, keys 1-7 step into each zone with its own URL, and Back walks out", async ({ page }) => {
  await openRoom(page);
  await expect(page.locator("#room-canvas")).toBeVisible();
  await expect(page.locator(".dock")).toHaveCount(0);
  for (let i = 0; i < ZONES.length; i++) {
    await page.keyboard.press(String(i + 1));
    await expect(page).toHaveURL(new RegExp(`/room/${ZONES[i]}$`));
    // v3.5: the URL changes when the move starts, ROOM.state.zone when it lands
    await expect.poll(async () => (await roomState(page)).zone).toBe(ZONES[i]);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/room\/computer$/);
  await expect.poll(async () => (await roomState(page)).zone).toBe("computer");
  // Out of a zone the room stays in that zone's view, and every view but the front has its own URL.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/room\/right$/);
  await expect.poll(async () => (await roomState(page)).zone).toBe(null);
  // A zone URL opens straight into the zone.
  await openRoom(page, "/room/gym");
  expect((await roomState(page)).zone).toBe("gym");
});

test("T opens Today; logging every core goal through the HUD is quick and reaches 100% after reload", async ({ page }) => {
  await openRoom(page);
  await page.keyboard.press("t");
  const rows = page.locator(".t-row");
  await expect(rows.first()).toBeVisible();
  const core = Number(sql(`select count(*) from public.plan_goals g join public.daily_plans p on p.id = g.plan_id where p.user_id = '${USER_ID}' and p.day = ((now() at time zone 'America/Chicago') - interval '4 hours')::date and g.kind <> 'stretch'`));
  expect(core).toBeGreaterThan(0);

  const started = Date.now();
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    if ((await row.getAttribute("aria-pressed")) !== "true") await row.click();
  }
  await expect
    .poll(
      () =>
        sql(`select count(*) from public.plan_goals g join public.daily_plans p on p.id = g.plan_id where p.user_id = '${USER_ID}' and p.day = ((now() at time zone 'America/Chicago') - interval '4 hours')::date and g.kind <> 'stretch' and g.result_tier is not null`),
      { timeout: 20_000 },
    )
    .toBe(String(core));
  expect(Date.now() - started).toBeLessThan(30_000);
  await expect(page.locator(".room-status")).toBeHidden();

  await openRoom(page);
  expect(await page.evaluate(() => (window as unknown as { ROOM: { data: { todayP: number } } }).ROOM.data.todayP)).toBe(100);
  await expect(page.getByRole("button", { name: /today's goals, 100%/i })).toBeVisible();
});

test("a double-click on a skill hotspot opens its panel, and holding Shift shows the nameplates", async ({ page }) => {
  await openRoom(page);
  // Art pass 4: the chess table stands in the window zone (key 4); its id stays library.chess.
  await page.keyboard.press("4");
  await expect(page).toHaveURL(/\/room\/window$/);
  await settled(page);
  // a single click opens the hologram (room-holo.spec.ts); a double-click goes straight to the skill view
  await page.locator('.hs[data-id="library.chess"]').dblclick({ force: true });
  const panel = page.locator(".ui-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-label", "Chess");
  await expect(panel.locator(".p-name")).toHaveText("Chess");
  // v3.5: the skill view has its own URL, in the item's real zone (the chess table stands in the window zone)
  await expect(page).toHaveURL(/\/room\/window\/chess$/);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/room\/window$/);
  await settled(page);

  await page.keyboard.down("Shift");
  await expect.poll(async () => (await roomState(page)).inspect).toBe(true);
  await page.keyboard.up("Shift");
});

test("a relic can be set on an empty mount and is saved", async ({ page }) => {
  await openRoom(page);
  await page.keyboard.press("4");
  await expect(page).toHaveURL(/\/room\/window$/);
  await settled(page);
  await page.locator('.hs[data-id="window.relic"]').click({ force: true });
  const panel = page.locator(".ui-panel");
  await panel.locator('[data-k="relic-Chess 1500"]').click();
  await panel.locator('[data-k="relic-target"]').fill("1500");
  await panel.locator('[data-k="relic-set"]').click();
  await expect
    .poll(() => sql(`select slot || ' ' || title || ' ' || coalesce(metric_key, '-') || ' ' || target from public.relics where user_id = '${USER_ID}' and status = 'active'`))
    .toBe("window Chess 1500 chess_rating 1500");
  await openRoom(page);
  expect(await page.evaluate(() => (window as unknown as { ROOM: { data: { relics: { slots: Record<string, { title: string } | null> } } } }).ROOM.data.relics.slots.window?.title)).toBe("Chess 1500");
});

test("v3.4: the arrow keys and chevrons pan round four walls, each view has its own URL, and a zone turns to its wall", async ({ page }) => {
  await openRoom(page);
  const view = async () => {
    // a view counts once its pan has finished
    const turning = await page.evaluate(() => (window as unknown as { ROOM: { render: { turning: boolean } } }).ROOM.render.turning);
    return turning ? "turning" : (await roomState(page)).view;
  };
  expect(await view()).toBe("front");
  await expect(page.locator("#turn-left")).toBeVisible();
  await expect(page.locator("#turn-right")).toBeVisible();
  // right, back, left, front: a full turn
  for (const [to, url] of [["right", /\/room\/right$/], ["back", /\/room\/back$/], ["left", /\/room\/left$/]] as const) {
    await page.keyboard.press("ArrowRight");
    await expect.poll(view).toBe(to);
    await expect(page).toHaveURL(url);
  }
  await expect(page.locator('.hs[data-id="bed.bed"]')).toHaveCount(1);
  await page.locator("#turn-right").click();
  await expect.poll(view).toBe("front");
  await expect(page).toHaveURL("http://localhost:3200/");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(view).toBe("left");
  await page.goBack();
  await expect.poll(view).toBe("front");
  // A view URL opens on that wall.
  await openRoom(page, "/room/back");
  expect(await view()).toBe("back");
  // Key 7 (gym) turns from the back wall to the right one and lands in the zone.
  await page.keyboard.press("7");
  await expect(page).toHaveURL(/\/room\/gym$/);
  await expect.poll(view).toBe("right");
  await expect(page.locator('.hs[data-id="gym.strength"]')).toHaveCount(1);
});

test("v3.4: the statue's plaque offers UPGRADE at 100%, and the level is saved and never auto-rises", async ({ page }) => {
  await openRoom(page);
  const room = () =>
    page.evaluate(() => {
      const R = (window as unknown as { ROOM: { statue: { info: () => { level: number; ready: boolean; score: number } } } }).ROOM;
      return R.statue.info();
    });
  // First load stores the score's whole part: no UPGRADE yet.
  const first = await room();
  expect(first.level).toBe(Math.floor(first.score));
  expect(sql(`select statue_level from public.profiles where user_id = '${USER_ID}'`)).toBe(String(first.level));
  await expect(page.locator(".statue-upgrade")).toBeHidden();
  // A level two below the score: the bar is full and UPGRADE appears; one press raises it by one.
  sql(`update public.profiles set statue_level = ${first.level - 2} where user_id = '${USER_ID}'`);
  await openRoom(page);
  await settled(page);
  expect((await room()).ready).toBe(true);
  const up = page.locator(".statue-upgrade");
  await expect(up).toBeVisible();
  await expect(up).toHaveAccessibleName(`Upgrade the statue to level ${first.level - 1}`);
  await up.click();
  await expect.poll(() => sql(`select statue_level from public.profiles where user_id = '${USER_ID}'`)).toBe(String(first.level - 1));
  // The database refuses to lower it.
  expect(() => sql(`set request.jwt.claim.sub = '${USER_ID}'; update public.profiles set statue_level = 0 where user_id = '${USER_ID}';`)).toThrow(/never drops/);
});

test("v3.4: the calendar wall on the back view: key 8, every day is a button, the study calendar leads there", async ({ page }) => {
  await openRoom(page);
  await page.keyboard.press("8");
  await expect(page).toHaveURL(/\/room\/calendar$/);
  await expect.poll(async () => (await roomState(page)).view).toBe("back");
  await settled(page);
  // a button per day of the month, named with the day, its completion and its events
  const days = page.locator(".cal-hit[aria-label*=' events'], .cal-hit[aria-label*=' event,'], .cal-hit[aria-label$=' event']");
  await expect(days.first()).toBeVisible();
  expect(await days.count()).toBeGreaterThanOrEqual(28);
  const today = page.locator(".cal-hit[aria-label*=', today']");
  await expect(today).toHaveCount(1);
  await expect(today).toHaveAttribute("aria-pressed", "true");
  // pick another day: it becomes the selected one
  const other = days.nth(2);
  await other.click();
  await expect.poll(() => other.getAttribute("aria-pressed")).toBe("true");
  // ADD opens Google Calendar (a link, no in-app form)
  await expect(page.locator("a.cal-hit")).toHaveAttribute("href", /^https:\/\/calendar\.google\.com\/calendar\/r\/eventedit\?dates=\d{8}\/\d{8}$/);
  // the study desk's wall calendar leads back to the wall
  await page.keyboard.press("Escape");
  await page.keyboard.press("5");
  await expect(page).toHaveURL(/\/room\/study$/);
  await settled(page);
  await page.locator('.hs[data-id="study.time"]').click({ force: true });
  await expect(page).toHaveURL(/\/room\/calendar$/);
});

test("v3.4: Time Blocking is retired: archived with its history, and the room has no object for it", async ({ page }) => {
  // the e2e reset re-activates every skill; apply the retirement as migration 0013 does
  sql(`update public.skills set status = 'archived', archived_at = now() where user_id = '${USER_ID}' and slug = 'time-blocking'`);
  await openRoom(page);
  const items = await page.evaluate(() =>
    (window as unknown as { ROOM: { art: { items: { target?: { skill?: string } }[] } } }).ROOM.art.items.filter((i) => i.target?.skill === "time-blocking").length,
  );
  expect(items).toBe(0);
  expect(sql(`select status from public.skills where user_id = '${USER_ID}' and slug = 'time-blocking'`)).toBe("archived");
});

test("v3.5: the keyboard map (Up/Down overview, arrows, Esc), and Up/Down are left alone in a text field", async ({ page }) => {
  await openRoom(page);
  await settled(page);
  const overview = await page.evaluate(() => (window as unknown as RoomW).ROOM.nav.overviewOn());
  if (overview) {
    await page.keyboard.press("ArrowUp");
    await expect(page).toHaveURL(/\/room\/overview$/);
    await expect.poll(async () => (await place(page)).mode).toBe("overview");
    await expect(page.locator("#nav-up")).toHaveAccessibleName("Back to room");
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await place(page)).mode).toBe("wall");
    await expect(page).toHaveURL("http://localhost:3200/");
  } else {
    // without the overview art the Up key and #nav-up do nothing
    await page.keyboard.press("ArrowUp");
    await settled(page);
    expect((await place(page)).mode).toBe("wall");
    await expect(page.locator("#nav-up")).toBeHidden();
  }
  // Right turns on a wall; in a zone Left/Right walk the zones in the global order (here across a wall)
  await page.keyboard.press("4");
  await expect.poll(async () => (await place(page)).zone).toBe("window");
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/room\/study$/);
  await expect.poll(async () => (await place(page)).view).toBe("right");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await place(page)).mode).toBe("wall");
  await expect(page).toHaveURL(/\/room\/right$/);
  // a text field keeps its keys: the help sheet has none, so use a throwaway input
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.id = "probe";
    document.body.appendChild(i);
    i.focus();
  });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await settled(page);
  expect(await place(page)).toMatchObject({ mode: "wall", view: "right" });
});

test("v3.5: reduced motion: every move lands in the same tick, the skill view opens and closes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoom(page);
  const step = (src: string) =>
    page.evaluate((src) => {
      const R = (window as unknown as RoomW).ROOM;
      R.debug.freeze();
      new Function(src)();
      const busy = R.nav.busy;
      R.debug.advance(16);
      const a = R.debug.readFrame().data;
      R.debug.advance(800);
      const b = R.debug.readFrame().data;
      let same = a.length === b.length;
      for (let i = 0; same && i < a.length; i += 97) same = a[i] === b[i];
      return { busy, place: R.nav.place, same };
    }, src);
  for (const src of ["ROOM.go('window')", "ROOM.go('gym')", "ROOM.turn(1)", "ROOM.nav.up()", "ROOM.nav.down()", "ROOM.go('library')"]) {
    const r = await step(src);
    expect(r.busy, src).toBe(false);
  }
  const open = await step("ROOM.nav.request({mode: 'skill', item: 'library.chess'})");
  expect(open.busy).toBe(false);
  expect(open.place).toMatchObject({ mode: "skill", item: "library.chess", zone: "window" });
  await expect(page.locator(".ui-panel")).toBeVisible();
  await expect(page).toHaveURL(/\/room\/window\/chess$/);
  const close = await step("ROOM.nav.back()");
  expect(close.busy).toBe(false);
  expect(close.place).toMatchObject({ mode: "zone", zone: "library" });
  await expect(page.locator(".ui-panel")).toBeHidden();
});

test("v3.5: interruptions: Esc mid-dolly reverses, three Rights are one move, Back after a close", async ({ page }) => {
  await openRoom(page);
  await settled(page);
  const before = await page.evaluate(() => history.length);
  // Esc during the dolly into a zone: the move reverses, no panel, the URL is the wall again
  await page.evaluate(() => {
    const R = (window as unknown as RoomW).ROOM;
    R.debug.freeze();
    (R as unknown as { go: (z: string) => void }).go("window");
    R.debug.advance(200);
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const R = (window as unknown as RoomW).ROOM;
    for (let i = 0; i < 80 && R.nav.busy; i++) R.debug.advance(16);
    (R as unknown as { debug: { thaw: () => void } }).debug.thaw();
  });
  await settled(page);
  expect(await place(page)).toMatchObject({ mode: "wall", view: "front" });
  await expect(page).toHaveURL("http://localhost:3200/");
  // three quick presses retarget one turn: one history entry, lands three walls on
  const h0 = await page.evaluate(() => history.length);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await settled(page);
  const p = await place(page);
  expect(["back", "left"]).toContain(p.view);
  expect(await page.evaluate(() => history.length)).toBe(h0 + 1);
  await page.goBack();
  await expect.poll(async () => (await place(page)).view).toBe("front");
  await settled(page);
  // open a skill view from a zone, close it, Back: the place before the zone, never back into the board
  await page.keyboard.press("4");
  await expect.poll(async () => (await place(page)).zone).toBe("window");
  await settled(page);
  // a single click opens the hologram (room-holo.spec.ts); a double-click goes straight to the skill view
  await page.locator('.hs[data-id="library.chess"]').dblclick({ force: true });
  await expect(page.locator(".ui-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ui-panel")).toBeHidden();
  await expect(page).toHaveURL(/\/room\/window$/);
  await settled(page);
  await page.goBack();
  await expect.poll(async () => (await place(page)).mode).toBe("wall");
  await expect(page).toHaveURL("http://localhost:3200/");
  expect(before).toBeGreaterThan(0);
});
