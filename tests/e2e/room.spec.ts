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
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("http://localhost:3200/");
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
