import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("first run walks through onboarding, then the dashboard uses the chosen rack", async ({ page }) => {
  sql(`update public.profiles set onboarded_at = null, focus_line = null where user_id = '${USER_ID}';
       update public.milestones set claimed_at = null where user_id = '${USER_ID}';`);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Identity over outcomes.")).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click(); // principles
  await expect(page.getByText("Your week")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click(); // schedule
  await expect(page.getByRole("button", { name: /Bench 225/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click(); // milestones
  await page.getByLabel("Chess username").fill("jaxon");
  await page.getByRole("button", { name: "Continue" }).click(); // baselines
  await page.getByRole("button", { name: /^Academics/ }).click(); // unpin
  await page.getByRole("button", { name: /^Chess/ }).click(); // pin
  await page.getByRole("button", { name: "Continue" }).click(); // rack
  await page.getByRole("textbox", { name: "Focus line" }).fill("Win the morning");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL("http://localhost:3200/");
  await expect(page.getByText("Win the morning")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Chess, \d+, locked 7 days$/ })).toBeVisible();
  await expect(page.locator("#today")).toContainText("Chess training");
  expect(Number(sql(`select count(*) from public.milestones where user_id = '${USER_ID}' and claimed_at is not null`))).toBe(5);
  expect(sql(`select value from public.metrics where user_id = '${USER_ID}' and key = 'bench_1rm'`)).toBe("240");
});

test("skill page explains the score, shows live milestone progress, and auto-claims from a metric", async ({ page }) => {
  sql(`insert into public.metrics (user_id, skill_id, key, value, day)
       select '${USER_ID}', id, 'bench_1rm', 240, current_date from public.skills where user_id = '${USER_ID}' and slug = 'strength'`);
  await page.goto("/s/strength");
  await expect(page.getByText("I'm strong and I train like an athlete.")).toBeVisible();
  await expect(page.getByText(/Score = 0\.7 x 16 \+ 0\.3 x \d+/)).toBeVisible();
  const ladder = page.getByRole("region", { name: "Milestones" });
  await expect(ladder).toContainText("Bench (top set or 1RM): 240 lb / 255 lb");

  await page.getByLabel("Bench (top set or 1RM) value").fill("255");
  await page.getByRole("region", { name: "Metrics" }).getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByText(/Score = 0\.7 x 23 \+/)).toBeVisible();
  await expect(ladder.locator("li", { hasText: "Bench 255" })).toContainText("Claimed");
});

test("a manual milestone can be claimed with a proof number, and undone", async ({ page }) => {
  await page.goto("/s/ai-building");
  const ladder = page.getByRole("region", { name: "Milestones" });
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
  const archive = page.locator('section[aria-label="Skill archive"]');
  await expect(archive.getByText("Trophy Room")).toBeVisible();
  await expect(archive.getByRole("img", { name: /^College Integration, score \d+$/ })).toBeVisible();

  await page.goto("/s/triathlon");
  await page.getByRole("button", { name: "Awaken" }).click();
  await expect(page.getByRole("button", { name: "Make dormant" })).toBeVisible();
  await page.goto("/");
  await expect(archive.getByRole("img", { name: /^Triathlon, score \d+$/ })).toBeVisible();
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
  await page.getByRole("region", { name: "Non-negotiables" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Standard minutes").fill("35");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("region", { name: "Non-negotiables" })).toContainText("(35 min)");

  await page.getByLabel("New log line").fill("Found a supplier with 5-day shipping");
  await page.getByRole("button", { name: "Log" }).click();
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
