import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetUser, signIn, sql, TODAY_SQL } from "./helpers";
import { openRoom } from "./room-helpers";
import { AUTH_COOKIE, sessionCookieValue, USER_ID } from "./stack/config.mjs";

// Admin view (/admin): floor plan + every dashboard. The e2e user is in ADMIN_EMAILS (scripts/e2e-stack.sh).
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const SHOTS = process.env.ADMIN_SHOTS; // a directory: also capture review screenshots

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

const openAdmin = async (page: Page, path = "/admin") => {
  await page.goto(path);
  await expect(page.locator("[data-admin-view][data-ready]")).toBeVisible({ timeout: 60_000 });
};

const skillId = (slug: string) => sql(`select id from public.skills where user_id = '${USER_ID}' and slug = '${slug}'`);

test("a non-admin gets a 404 and no ADMIN toggle in the room", async ({ page }) => {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: AUTH_COOKIE, value: sessionCookieValue("someone@forge.test"), domain: "localhost", path: "/" }]);
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.locator("[data-admin-view]")).toHaveCount(0);
  expect((await page.goto("/admin/s/reading"))?.status()).toBe(404);
  await openRoom(page);
  await expect(page.locator(".strip-admin")).toBeHidden();
});

test("the ADMIN toggle in the room opens /admin, and ROOM goes back", async ({ page }) => {
  await openRoom(page);
  const toggle = page.locator(".strip-admin");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("[data-admin-view]")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Back to the room" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test("every hotspot has a plan box and a tile; tiles and objects share callout numbers", async ({ page }) => {
  await openAdmin(page);
  const plan = JSON.parse(await (await page.request.get("/room/plan.json")).text()) as { objects: { id: string }[] };
  expect(plan.objects.length).toBeGreaterThanOrEqual(29);
  for (const o of plan.objects) {
    const g = page.locator(`.fp-obj[data-obj="${o.id}"]`);
    await expect(g, o.id).toHaveCount(1);
    const tile = await g.getAttribute("data-tile");
    await expect(page.locator(`.adm-tile[data-tile="${tile}"]`), `${o.id} -> ${tile}`).toHaveCount(1);
  }
  // leader lines are drawn for every object on a laptop
  await expect.poll(() => page.locator(".adm-leaders line").count()).toBe(plan.objects.length);
  for (const id of ["overall", "categories", "board", "calendar", "review", "review/month", "relics", "archive", "settings", "debug"]) {
    await expect(page.locator(`.adm-tile[data-tile="${id}"]`), id).toHaveCount(1);
  }
});

test("click expands a tile in place (URL updates), Esc collapses, Enter on a focused tile expands, Back closes", async ({ page }) => {
  await openAdmin(page);
  await page.locator('.adm-tile[data-tile="s/reading"] .t-link').click();
  await expect(page).toHaveURL(/\/admin\/s\/reading$/);
  const panel = page.locator("[data-admin-panel]");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { level: 1, name: "Reading" })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("ADMIN / LIFECYCLE")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-1280-expanded-skill.png` });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(panel).toHaveCount(0);
  // focus returns to the tile; Enter opens it again
  await expect(page.locator('[data-tile-link="s/reading"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/s\/reading$/);
  await expect(panel).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(panel).toHaveCount(0);
  // a plan object opens its tile too, and a shared link opens expanded
  await page.locator('.fp-obj[data-obj="window.statue"]').click();
  await expect(page).toHaveURL(/\/admin\/overall$/);
  await openAdmin(page, "/admin/settings");
  await expect(page.locator("[data-admin-panel]").getByText("Connection check")).toBeVisible({ timeout: 30_000 });
  // an unknown item is the not-found page (the status is already sent when the page streams, so check the UI)
  await page.goto("/admin/s/not-a-skill");
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  await expect(page.locator("[data-admin-view]")).toHaveCount(0);
});

test("logging from a tile updates today's goal and the tile; undo clears it", async ({ page }) => {
  await openAdmin(page);
  const tile = page.locator(".adm-tile:has(.t-log)").first();
  const id = (await tile.getAttribute("data-tile"))!;
  const slug = id.slice(2);
  const result = () =>
    sql(`select coalesce(g.result_tier::text, '') from public.plan_goals g join public.daily_plans p on p.id = g.plan_id
         join public.skills s on s.id = g.skill_id where p.user_id = '${USER_ID}' and p.day = ${TODAY_SQL} and s.slug = '${slug}' order by g.sort limit 1`);
  await tile.getByRole("button", { name: /at standard$/ }).click();
  await expect.poll(result).toBe("standard");
  await expect(page.locator(`.adm-tile[data-tile="${id}"]`).getByRole("button", { name: /at standard$/ })).toHaveAttribute("aria-pressed", "true");
  await page.locator(`.adm-tile[data-tile="${id}"]`).getByRole("button", { name: /^Undo/ }).click();
  await expect.poll(result).toBe("");
});

test("a goal edit persists; archive and restore round trip; category change", async ({ page }) => {
  await openAdmin(page, "/admin/s/reading");
  const panel = page.locator("[data-admin-panel]");
  const form = panel.locator("form.adm-goal").first();
  await expect(form).toBeVisible({ timeout: 30_000 });
  const nnId = sql(`select id from public.non_negotiables where skill_id = '${skillId("reading")}' order by sort limit 1`);
  const before = sql(`select floor_text from public.non_negotiables where id = '${nnId}'`);
  await form.getByLabel("FLOOR", { exact: true }).fill("Read 5 pages (admin edit)");
  await form.getByRole("button", { name: "SAVE GOAL" }).click();
  await expect.poll(() => sql(`select floor_text from public.non_negotiables where id = '${nnId}'`)).toBe("Read 5 pages (admin edit)");
  sql(`update public.non_negotiables set floor_text = '${before.replace(/'/g, "''")}' where id = '${nnId}'`);

  // reading is not on the rack, so it can be archived
  await panel.getByRole("button", { name: "ARCHIVED" }).click();
  await expect.poll(() => sql(`select status from public.skills where id = '${skillId("reading")}'`)).toBe("archived");
  await page.keyboard.press("Escape");
  await expect(page.locator('.adm-tile[data-tile="s/reading"]')).toHaveClass(/is-off/);
  await page.locator('.adm-tile[data-tile="archive"] .t-link').click();
  await page.locator("[data-admin-panel]").getByRole("button", { name: "Restore Reading" }).click();
  await expect.poll(() => sql(`select status from public.skills where id = '${skillId("reading")}'`)).toBe("active");

  // category: move reading and put it back
  const cat = sql(`select category_id from public.skills where id = '${skillId("reading")}'`);
  const other = sql(`select id from public.categories where user_id = '${USER_ID}' and id <> '${cat}' order by sort limit 1`);
  await openAdmin(page, "/admin/s/reading");
  await page.locator("[data-admin-panel]").getByLabel("CATEGORY").selectOption(other);
  await expect.poll(() => sql(`select category_id from public.skills where id = '${skillId("reading")}'`)).toBe(other);
  sql(`update public.skills set category_id = '${cat}' where id = '${skillId("reading")}'`);
});

test("room debug builds the room URL from the flags and opens the room with them", async ({ page }) => {
  await openAdmin(page, "/admin/debug");
  const panel = page.locator("[data-admin-panel]");
  await panel.getByLabel("WEATHER").selectOption("rain");
  await panel.getByLabel("NIGHT").selectOption("1");
  await panel.getByRole("button", { name: "CANVAS2D (GL OFF)" }).click();
  await expect(panel.locator("[data-room-url]")).toHaveText("/?weather=rain&night=1&gl=off");
  await panel.locator("[data-room-open]").click();
  await expect(page).toHaveURL(/\/\?weather=rain&night=1&gl=off$/);
  await expect(page.locator("#room-canvas")).toBeVisible({ timeout: 60_000 });
});

test("axe finds no violations on /admin and on an expanded tile", async ({ page }) => {
  await openAdmin(page);
  const plain = await new AxeBuilder({ page }).include("[data-admin-view]").analyze();
  expect(plain.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.locator('.adm-tile[data-tile="debug"] .t-link').click();
  await expect(page.locator("[data-admin-panel]").getByText("ROOM DEBUG / QUERY FLAGS")).toBeVisible();
  const open = await new AxeBuilder({ page }).include("[data-admin-panel]").analyze();
  expect(open.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-1280-expanded-debug.png` });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test("the plan stacks above a tile list", async ({ page }) => {
    await openAdmin(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-390.png`, fullPage: false });
    const plan = await page.locator(".adm-plan").boundingBox();
    const list = await page.locator(".adm-list-phone").boundingBox();
    expect(plan && list && list.y >= plan.y + plan.height - 1).toBe(true);
    expect(plan!.width).toBeGreaterThan(330);
    await expect(page.locator(".adm-leaders")).toHaveCount(0);
    const scrollW = await page.locator(".adm").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(scrollW).toBeLessThanOrEqual(0);
  });
});

test("review screenshots", async ({ page }) => {
  test.skip(!SHOTS, "set ADMIN_SHOTS=<dir> to capture");
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  for (const [w, h] of [
    [1280, 800],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w!, height: h! });
    await openAdmin(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/admin-${w}.png` });
  }
  expect(errors).toEqual([]);
});
