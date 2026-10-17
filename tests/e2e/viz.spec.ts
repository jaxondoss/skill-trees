import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("every skill page draws its own visualization", async ({ page }) => {
  for (const slug of ["ai-building", "dropshipping", "academics", "reading", "college-integration", "time-blocking", "chess", "meditation", "visualization", "strength", "running", "sleep", "triathlon", "food", "gut-health"]) {
    await page.goto(`/s/${slug}`);
    await expect(page.locator('section[aria-labelledby="viz-title"]')).toBeVisible();
  }
});

test("a top set logged under the chart draws the lift and states it", async ({ page }) => {
  await page.goto("/s/strength");
  const viz = page.locator('section[aria-labelledby="viz-title"]');
  await viz.getByLabel("Lift").selectOption({ label: "Deadlift" });
  await viz.getByLabel("Weight (lb)").fill("315");
  await viz.getByLabel("Reps").fill("3");
  await viz.getByRole("button", { name: "Log top set" }).click();
  await expect(viz).toContainText("about 347 estimated max");
  await expect(viz.getByRole("img", { name: /estimated one rep max over 12 weeks/ })).toBeVisible();
  expect(sql(`select value from public.metrics where user_id = '${USER_ID}' and key = 'deadlift_1rm'`)).toBe("347");
});

test("a conversation lands on the people map", async ({ page }) => {
  await page.goto("/s/college-integration");
  const viz = page.locator('section[aria-labelledby="viz-title"]');
  await viz.getByLabel("Who").fill("Studio partner");
  await viz.getByLabel("Where you know them from").selectOption("Classes");
  await viz.getByRole("button", { name: "Log a conversation" }).click();
  await expect(viz).toContainText("1 person");
  await expect(viz.getByRole("img")).toContainText("Studio partner");
  sql(`delete from public.metrics where user_id = '${USER_ID}' and key = 'conversation'`);
});

test("gut habits replace today's set when saved again", async ({ page }) => {
  await page.goto("/s/gut-health");
  const viz = page.locator('section[aria-labelledby="viz-title"]');
  await viz.getByRole("button", { name: "Water 3 L" }).click();
  await viz.getByRole("button", { name: "Fiber 38 g" }).click();
  await viz.getByRole("button", { name: "Save today" }).click();
  await expect(viz).toContainText("Saved 2 of 4 for today.");
  await viz.getByRole("button", { name: "Water 3 L" }).click();
  await viz.getByRole("button", { name: "Save today" }).click();
  await expect(viz).toContainText("Saved 1 of 4 for today.");
  expect(sql(`select count(*) from public.metrics where user_id = '${USER_ID}' and key = 'gut_habit'`)).toBe("1");
});
