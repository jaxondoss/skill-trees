import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("skill page explains the score, shows live milestone progress, and auto-claims from a metric", async ({ page }) => {
  sql(`insert into public.metrics (user_id, skill_id, key, value, day)
       select '${USER_ID}', id, 'bench_1rm', 240, current_date from public.skills where user_id = '${USER_ID}' and slug = 'strength'`);
  await page.goto("/s/strength");
  await expect(page.getByText("I'm strong and I train like an athlete.")).toBeVisible();
  await expect(page.getByText(/Score = 0\.7 x 16 \+ 0\.3 x \d+/)).toBeVisible();
  const ladder = page.getByRole("region", { name: "Steps" });
  await expect(ladder).toContainText("Bench (top set or 1RM): 240 lb / 255 lb");

  await page.getByLabel("Bench (top set or 1RM) value").fill("255");
  await page.getByRole("region", { name: "Metrics" }).getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByText(/Score = 0\.7 x 23 \+/)).toBeVisible();
  await expect(ladder.locator("li", { hasText: "Bench 255" })).toContainText("Claimed");
});

test("a manual milestone can be claimed with a proof number, and undone", async ({ page }) => {
  await page.goto("/s/ai-building");
  const ladder = page.getByRole("region", { name: "Steps" });
  const next = ladder.locator("li", { hasText: "Deployed a project publicly" });
  await next.getByRole("button", { name: "Claim" }).click();
  await page.getByLabel("Proof number (optional)").fill("1");
  await page.getByRole("button", { name: "Claim +7" }).click();
  await expect(next).toContainText("Claimed");
  await expect(next).toContainText("Proof: 1");
  await expect(page.getByText(/Score = 0\.7 x 15 \+/)).toBeVisible();

  await next.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Score = 0\.7 x 8 \+/)).toBeVisible();
});

test("crossing 34 unlocks new guidance once", async ({ page }) => {
  sql(`update public.milestones m set claimed_at = now() from public.skills s
       where m.skill_id = s.id and s.slug = 'chess' and m.user_id = '${USER_ID}' and m.sort < 7`);
  await page.goto("/s/chess");
  await expect(page.getByRole("button", { name: /New guidance unlocked/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Guidance: Development" })).toContainText("Learn core endgames.");
  await page.getByRole("button", { name: /New guidance unlocked/ }).click();
  await page.reload();
  await expect(page.getByRole("region", { name: "Guidance: Development" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New guidance unlocked/ })).toHaveCount(0);
});

test("archive sends a skill to the Trophy Room; awaken brings Triathlon into play", async ({ page }) => {
  await page.goto("/s/college-integration");
  await page.getByRole("region", { name: "Manage" }).getByRole("button", { name: "Archive" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL("http://localhost:3200/");
  await expect(page.getByRole("link", { name: /^College Integration, Trophy Room\./ })).toBeVisible();

  await page.goto("/s/triathlon");
  await page.getByRole("button", { name: "Awaken" }).click();
  await expect(page.getByRole("button", { name: "Make dormant" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Triathlon, \d+\./ })).toBeVisible();
});

test("a locked rack skill cannot be archived", async ({ page }) => {
  sql(`update public.rack_pins set locked_until = now() + interval '7 days' where user_id = '${USER_ID}'`);
  await page.goto("/s/strength");
  await page.getByRole("region", { name: "Manage" }).getByRole("button", { name: "Archive" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("region", { name: "Manage" }).getByRole("alert")).toContainText("locked on the rack");
});

test("editing a non-negotiable and logging a note", async ({ page }) => {
  await page.goto("/s/dropshipping");
  const goals = page.getByRole("region", { name: "Goals" });
  await goals.getByRole("button", { name: "Edit Store work" }).click();
  await goals.getByLabel("Standard minutes").fill("35");
  await goals.getByRole("button", { name: /^Save/ }).click();
  await expect(goals).toContainText("35 min");

  const logRegion = page.getByRole("region", { name: "Log" });
  await logRegion.getByLabel("New log line").fill("Found a supplier with 5-day shipping");
  await logRegion.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByRole("region", { name: "Log" })).toContainText("Found a supplier with 5-day shipping");
  sql(`update public.non_negotiables n set standard_min = 40 from public.skills s where n.skill_id = s.id and s.slug = 'dropshipping'`);
});

test("every score explains itself: overall page and category history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Overall score \d+/ }).first().click();
  await expect(page).toHaveURL(/\/overall$/);
  await expect(page.getByText(/\/ 5 = \d+\.\d/)).toBeVisible();
  await page.getByRole("link", { name: /Mind/ }).click();
  await expect(page).toHaveURL(/\/c\/mind$/);
  await page.getByRole("link", { name: /Chess/ }).click();
  await expect(page).toHaveURL(/\/s\/chess$/);
});
