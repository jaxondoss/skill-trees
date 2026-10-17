import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test.afterEach(() => {
  sql(`delete from public.non_negotiables where user_id = '${USER_ID}' and name like 'E2E %';
       delete from public.milestones where user_id = '${USER_ID}' and title like 'E2E %';
       delete from public.journal_entries where user_id = '${USER_ID}';`);
});

test("a goal is added to a skill, filled in, and deleted", async ({ page }) => {
  await page.goto("/s/reading");
  const goals = page.getByRole("region", { name: "Goals" });
  await goals.getByLabel("Add a goal for Reading…").fill("E2E Read on the bus");
  await goals.getByRole("button", { name: "Add" }).click();
  // A new goal opens its details straight away.
  await goals.getByLabel("What the task involves").fill("Kindle, 20 pages, both ways");
  const tue = goals.getByRole("button", { name: "Tue", exact: true });
  await expect(tue).toHaveAttribute("aria-pressed", "true");
  await tue.click();
  await expect(tue).toHaveAttribute("aria-pressed", "false");
  await goals.getByRole("button", { name: /^Save/ }).click();
  await expect(goals.getByLabel("What the task involves")).toHaveCount(0);
  await expect(goals).toContainText("Kindle, 20 pages, both ways");
  expect(sql(`select array_length(days_of_week, 1) from public.non_negotiables where user_id = '${USER_ID}' and name = 'E2E Read on the bus'`)).toBe("6");

  await goals.getByRole("button", { name: "Edit E2E Read on the bus" }).click();
  await goals.getByRole("button", { name: "Delete" }).click();
  await expect(goals).not.toContainText("E2E Read on the bus");
});

test("a step is added with a size and details", async ({ page }) => {
  await page.goto("/s/chess");
  const steps = page.getByRole("region", { name: "Steps" });
  await steps.getByLabel("Add a step…").fill("E2E Win a club tournament");
  await steps.getByRole("button", { name: "Add" }).click();
  await steps.getByRole("button", { name: "Large, 20" }).click();
  await steps.getByLabel("Details").fill("Tulane chess club, spring");
  await steps.getByRole("button", { name: /^Save/ }).click();
  await expect(steps.getByLabel("Details")).toHaveCount(0);
  await expect(steps).toContainText("Tulane chess club, spring");
  expect(sql(`select points from public.milestones where user_id = '${USER_ID}' and title = 'E2E Win a club tournament'`)).toBe("20");
});

test("adding a goal from Today puts it on today's plan", async ({ page }) => {
  await page.goto("/");
  const today = page.locator("#today");
  await today.getByLabel("New goal for today").fill("E2E Stretch hips");
  await today.getByLabel("Skill").selectOption({ label: "Strength" });
  await today.getByRole("button", { name: "Add", exact: true }).click();
  await expect(today).toContainText("E2E Stretch hips");
});

test("the journal saves to Mind from the L key", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Journal" });
  // The key listener attaches on hydration; press until it answers.
  await expect(async () => {
    await page.keyboard.press("l");
    await expect(dialog).toBeVisible({ timeout: 500 });
  }).toPass();
  await dialog.getByLabel("Entry").fill("Quiz went fine. Rushed the setup again.");
  await dialog.getByRole("button", { name: "Steady" }).click();
  await dialog.getByRole("button", { name: "Save to Mind" }).click();
  await expect(page.getByText("Saved to Mind.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Journal" })).toContainText("Quiz went fine. Rushed the setup again.");
  expect(sql(`select mood from public.journal_entries where user_id = '${USER_ID}'`)).toBe("steady");
});
