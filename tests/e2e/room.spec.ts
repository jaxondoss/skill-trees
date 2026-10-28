import { expect, test, type Page } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

// The v3 room at / (spec docs/SPEC-v3-room.md), on a laptop screen.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const ZONES = ["kitchen", "bed", "library", "window", "study", "computer", "gym"];

async function openRoom(page: Page, path = "/") {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((window as unknown as { ROOM?: { debug?: unknown } }).ROOM?.debug));
}
// Hotspots are switched off while the camera moves (dolly or pan); wait for it to land before clicking one.
const settled = (page: Page) =>
  page.waitForFunction(() => {
    const r = (window as unknown as { ROOM: { render: { dolly: unknown; turning: boolean } } }).ROOM.render;
    return !r.dolly && !r.turning;
  });
const roomState = (page: Page) => page.evaluate(() => (window as unknown as { ROOM: { state: Record<string, unknown> } }).ROOM.state);

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
    expect((await roomState(page)).zone).toBe(ZONES[i]);
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

test("a skill hotspot opens its panel, and holding Shift shows the nameplates", async ({ page }) => {
  await openRoom(page);
  // Art pass 4: the chess table stands in the window zone (key 4); its id stays library.chess.
  await page.keyboard.press("4");
  await expect(page).toHaveURL(/\/room\/window$/);
  await settled(page);
  await page.locator('.hs[data-id="library.chess"]').click({ force: true });
  const panel = page.locator(".ui-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-label", "Chess");
  await expect(panel.locator(".p-name")).toHaveText("Chess");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

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
