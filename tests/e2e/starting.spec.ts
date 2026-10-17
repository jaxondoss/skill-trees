import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

// Clearing removes the seeded goals and steps every other test relies on: back them up and restore.
test.beforeEach(async ({ page }) => {
  resetUser();
  sql(`drop table if exists public.e2e_nn; create table public.e2e_nn as select * from public.non_negotiables where user_id = '${USER_ID}';
       drop table if exists public.e2e_ms; create table public.e2e_ms as select * from public.milestones where user_id = '${USER_ID}';`);
  await signIn(page);
});

test.afterEach(() => {
  sql(`delete from public.non_negotiables where user_id = '${USER_ID}'; insert into public.non_negotiables select * from public.e2e_nn;
       delete from public.milestones where user_id = '${USER_ID}'; insert into public.milestones select * from public.e2e_ms;
       drop table public.e2e_nn; drop table public.e2e_ms;`);
});

test("start with empty lists clears goals and open steps, then starter ideas fill one back in", async ({ page }) => {
  sql(`update public.milestones m set claimed_at = now() from public.skills s where m.skill_id = s.id and s.slug = 'reading' and m.sort = 0`);
  const claimed = sql(`select count(*) from public.milestones where user_id = '${USER_ID}' and claimed_at is not null`);
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Starting content" });
  await section.getByRole("button", { name: "Start with empty lists" }).click();
  await expect(section.getByRole("button", { name: "Clear the lists" })).toBeDisabled();
  await section.getByLabel("Type clear to confirm").fill("clear");
  await section.getByRole("button", { name: "Clear the lists" }).click();
  await expect(section).toContainText(/Cleared \d+ goals and \d+ open steps/);
  expect(sql(`select count(*) from public.non_negotiables where user_id = '${USER_ID}'`)).toBe("0");
  // The claimed step stays, so its level is kept.
  expect(sql(`select count(*) from public.milestones where user_id = '${USER_ID}'`)).toBe(claimed);

  await page.goto("/s/reading");
  const goals = page.getByRole("region", { name: "Goals" });
  await expect(goals).toContainText("No goals yet");
  await goals.getByRole("button", { name: "Read" }).click();
  await expect(goals.getByRole("button", { name: "Edit Read" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator("a[data-skill-tile]", { hasText: "Meditation" })).toContainText("Empty to-do list");
});
