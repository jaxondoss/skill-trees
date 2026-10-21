import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays } from "../../src/engine/time";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

const coreRows = (page: Page) => page.locator('#today li:has(button[aria-label^="Complete"], button[aria-label^="Undo"])').filter({ hasNot: page.locator(".border-dashed") });
const checkbox = (row: Locator) => row.locator('button[aria-pressed]');
const todayPercent = (page: Page) => page.getByRole("button", { name: /Jump to today's goals/ });

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("smoke: complete 3 goals, then the ring, calendar, and bottles update", async ({ page }) => {
  await page.goto("/board");
  await expect(todayPercent(page)).toContainText("0%");
  const before = await page.locator('#today button[aria-label^="Dropshipping,"]').getAttribute("aria-label");

  const rows = coreRows(page);
  const n = await rows.count();
  const pct = `${Math.round(300 / n)}%`;
  for (let i = 0; i < 3; i++) {
    await checkbox(rows.nth(i)).click();
    await expect(checkbox(rows.nth(i))).toHaveAttribute("aria-pressed", "true");
  }

  // 3 core goals at Standard out of n.
  await expect(todayPercent(page)).toContainText(pct);
  const todayCell = page.locator(`section[aria-label="Completion calendar"] button[aria-label$=": ${pct}"]`);
  await expect(todayCell).toBeVisible();
  await expect(page.locator('#today button[aria-label^="Dropshipping,"]')).not.toHaveAttribute("aria-label", before!);

  // It persisted: a reload shows the same state.
  await page.reload();
  await expect(todayPercent(page)).toContainText(pct);
});

test("a full day's logging takes under 30 seconds", async ({ page }) => {
  await page.goto("/board");
  const rows = coreRows(page);
  const n = await rows.count();
  const started = Date.now();
  for (let i = 0; i < n; i++) await checkbox(rows.nth(i)).click();
  await expect(todayPercent(page)).toContainText("100%");
  const elapsed = Date.now() - started;
  console.log(`logged ${n} goals in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(30_000);
});

test("tap again undoes a completion", async ({ page }) => {
  await page.goto("/board");
  const row = coreRows(page).first();
  await checkbox(row).click();
  await expect(checkbox(row)).toHaveAttribute("aria-pressed", "true");
  await checkbox(row).click();
  await expect(checkbox(row)).toHaveAttribute("aria-pressed", "false");
  await expect(todayPercent(page)).toContainText("0%");
});

test("long-press opens tiers, intention, and notes; choosing Floor logs at Floor", async ({ page }) => {
  await page.goto("/board");
  const row = coreRows(page).first();
  await row.scrollIntoViewIfNeeded();
  const box = (await row.locator("p").last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("After my build session, I spend 40 minutes on the store.");
  await sheet.getByRole("button", { name: /^Floor/ }).click();
  await expect(sheet).toBeHidden();
  await expect(checkbox(row)).toHaveAttribute("aria-pressed", "true");
  await expect(row).toContainText("Floor");
  // Floor is half credit.
  await expect(todayPercent(page)).toContainText(`${Math.round(50 / (await coreRows(page).count()))}%`);

  await row.getByRole("button", { name: /^Options for/ }).click();
  await page.getByLabel("One-line note").fill("Did listings only");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Did listings only");
});

test("swipe left swaps a goal, once per day", async ({ page }) => {
  await page.goto("/board");
  const balance = page.locator("#today h3:has-text('Balance') + ul li").first();
  const name = await balance.locator("p").first().textContent();
  await balance.scrollIntoViewIfNeeded();
  const box = (await balance.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7 - 60, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.7 - 160, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator("#today")).not.toContainText(name!);
  await expect(page.getByText("Swipe a goal left to swap it")).toBeHidden();
  expect(sql(`select swap_used from public.daily_plans where user_id = '${USER_ID}'`)).toBe("t");

  await coreRows(page).first().getByRole("button", { name: /^Options for/ }).click();
  await expect(page.getByRole("button", { name: "Today's swap is used" })).toBeDisabled();
});

test("pinning locks a skill for 7 days; an unlocked pin can be replaced", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: /^Academics, \d+$/ }).click();
  await page.getByRole("button", { name: "Remove Academics from the rack" }).click();
  await expect(page.getByRole("button", { name: "Empty slot 5. Pin a skill" })).toBeVisible();

  await page.getByRole("button", { name: "Empty slot 5. Pin a skill" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Chess/ }).click();
  const chess = page.getByRole("button", { name: /^Chess, \d+, locked 7 days$/ });
  await expect(chess).toBeVisible();
  // Chess is scheduled daily, so it joined today's plan.
  await expect(page.locator("#today")).toContainText("Chess training");

  await chess.click();
  await expect(page.getByRole("status")).toContainText("Chess is locked for 7 more days.");
  // The database enforces the lock too.
  expect(() => sql(`set request.jwt.claim.sub = '${USER_ID}'; delete from public.rack_pins where slot = 5;`)).toThrow(/locked/);
});

test("calendar day opens a detail sheet with each goal's result", async ({ page }) => {
  await page.goto("/board");
  await checkbox(coreRows(page).first()).click();
  await page.locator('section[aria-label="Completion calendar"] button.today-pulse').click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Store work");
  await expect(sheet).toContainText("Standard");
  await expect(sheet).toContainText("Missed");
});

test("a broken streak cracks once, then shows the ending and best", async ({ page }) => {
  // Four kept days, then a day at 40%. Today stays open.
  const today = sql(`select (now() at time zone 'America/Chicago' - interval '4 hours')::date`);
  const rows = [90, 90, 95, 100, 40].map((p, i) => `('${USER_ID}', '${addDays(today, i - 5)}', ${p}, 7, ${p >= 85})`).join(",");
  sql(`insert into public.daily_completions (user_id, day, p, n_core, kept_streak) values ${rows}`);

  await page.goto("/board");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Streak ended at 4. Best: 4.");
  await dialog.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Streak 0 days\. Best 4/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
