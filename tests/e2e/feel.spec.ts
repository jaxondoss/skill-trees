import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("rising into a new tier plays the tier-up moment once", async ({ page }) => {
  // About a third of every skill's milestones: overall lands in Tier II.
  sql(`update public.milestones set claimed_at = now() where user_id = '${USER_ID}' and sort < 4`);
  await page.goto("/board");
  const moment = page.getByRole("alertdialog", { name: /^Tier II: Awakened$/ });
  await expect(moment).toBeVisible();
  await expect(moment).toBeHidden({ timeout: 5000 }); // under 3 seconds, then gone
  const hero = page.locator('section[aria-label="The statue"]');
  await expect(hero).toContainText("II Awakened");

  await page.reload();
  await expect(hero).toContainText("II Awakened");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(sql(`select seen_figure_tier from public.profiles where user_id = '${USER_ID}'`)).toBe("2");
});

test("a tier drop is recorded quietly, so rising again celebrates again", async ({ page }) => {
  sql(`update public.profiles set seen_figure_tier = 3 where user_id = '${USER_ID}'`);
  await page.goto("/board");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(sql(`select seen_figure_tier from public.profiles where user_id = '${USER_ID}'`)).toBe("1");
});

test("the statue lights seven vein regions, and reduced motion stops the breathing halo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/board");
  const hero = page.locator('section[aria-label="The statue"]');
  await expect(hero.locator("img.vein")).toHaveCount(7);
  const duration = await hero.locator(".hero-halo").evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
