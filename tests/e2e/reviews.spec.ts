import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PASSAGES, wordCount } from "../../src/content/reading-passages";
import { resetUser, seedHistory, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("a timed reading test saves wpm, comprehension, and the effective rate", async ({ page }) => {
  const passage = PASSAGES[0]!;
  await page.clock.install();
  await page.goto("/s/reading");
  const region = page.getByRole("region", { name: "Reading test" });
  await expect(region).toContainText("A reading test is due.");
  await region.getByRole("button", { name: "Start the clock" }).click();
  await expect(region.getByRole("heading", { name: passage.title })).toBeVisible();
  await page.clock.fastForward(120_000);
  await region.getByRole("button", { name: "Done reading" }).click();

  for (const [i, q] of passage.questions.entries()) {
    await region.getByRole("group", { name: new RegExp(`^${i + 1}\\.`) }).getByLabel(q.options[q.answerIndex]!, { exact: true }).check();
  }
  await region.getByRole("button", { name: "Check answers" }).click();
  const wpm = Math.round(wordCount(passage.text) / 2);
  await expect(region.getByText("5 of 5 right in 120 seconds.")).toBeVisible();
  await expect(region).toContainText("This first test is your baseline.");
  await region.getByRole("button", { name: "Save result" }).click();
  await expect(region.getByRole("table", { name: "Past reading tests" })).toContainText(`${wpm}`);

  const row = sql(`select value, source, meta->>'comprehensionPct' from public.metrics where user_id = '${USER_ID}' and key = 'reading_effective_rate'`);
  expect(row).toBe(`${wpm}|reading_test|100`);
  // The next test moves two weeks out, and the next passage is a new one.
  await expect(region).toContainText("Next test");
});

test("the weekly review sets the focus line, decides difficulty once, and records store numbers", async ({ page }) => {
  seedHistory("strength", 7, "standard");
  await page.goto("/review");
  const difficulty = page.getByRole("region", { name: "Difficulty" });
  await expect(difficulty).toContainText("Strength: You've crushed this. Level it up?");
  await expect(difficulty).toContainText("Default tier Standard to Stretch.");
  await difficulty.getByRole("button", { name: "Accept" }).click();

  await page.getByRole("textbox", { name: "What got in the way this week?" }).fill("Two late nights before the Calc quiz.");
  await page.getByRole("textbox", { name: "Next week's focus line" }).fill("Win the morning");
  const store = page.getByRole("region", { name: "Store this week" });
  await store.getByLabel("Revenue").fill("1200");
  await store.getByLabel("Ad spend").fill("300");
  await store.getByLabel("Orders").fill("30");
  await expect(page.getByRole("button", { name: "Write a debrief with Claude" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved.")).toBeVisible();

  const tier = () =>
    sql(`select n.default_tier from public.non_negotiables n join public.skills s on s.id = n.skill_id where s.user_id = '${USER_ID}' and s.slug = 'strength' order by n.sort limit 1`);
  expect(tier()).toBe("stretch");
  expect(sql(`select focus_line || '|' || kept_days from public.weekly_reviews where user_id = '${USER_ID}'`)).toMatch(/^Win the morning\|\d$/);
  expect(sql(`select string_agg(key || '=' || value::int, ',' order by key) from public.metrics where user_id = '${USER_ID}' and source = 'weekly_review'`)).toBe(
    "ad_spend_week_usd=300,orders_week=30,revenue_week_usd=1200",
  );

  // Saving again does not level it up twice.
  await page.reload();
  await expect(difficulty).toContainText("Default tier is now Stretch.");
  await page.getByRole("button", { name: "Update review" }).click();
  await expect(page.getByText("Review saved.")).toBeVisible();
  expect(tier()).toBe("stretch");

  await page.goto("/");
  await expect(page.getByText("Win the morning")).toBeVisible();
});

test("the monthly review logs calibration and adds a skill that asks for milestones", async ({ page }) => {
  await page.goto("/review/month");
  await expect(page.getByText("No snapshot from last month yet.")).toBeVisible();
  await page.getByRole("group", { name: /^Strength: does \d+ feel true\?$/ }).getByRole("button", { name: "Too high" }).click();
  await page.getByRole("button", { name: "Save monthly review" }).click();
  await expect(page.getByText("Monthly review saved.")).toBeVisible();
  expect(
    sql(`select r.calibrations ->> s.id::text from public.monthly_reviews r join public.skills s on s.user_id = r.user_id and s.slug = 'strength' where r.user_id = '${USER_ID}'`),
  ).toBe("too_high");

  await page.getByLabel("Skill name").fill("E2E Spanish");
  await page.getByLabel("Identity").fill("I am someone who speaks with people in their language.");
  await page.getByRole("button", { name: "Add skill" }).click();
  await expect(page).toHaveURL(/\/s\/e2e-spanish$/);
  await expect(page.getByText("Milestones total 0 of 100. Add more until they reach 100.")).toBeVisible();
  expect(sql(`select count(*) from public.non_negotiables n join public.skills s on s.id = n.skill_id where s.slug = 'e2e-spanish'`)).toBe("1");
});

test("a goal logged offline is kept on the phone and syncs when the connection returns", async ({ page, context }) => {
  await page.goto("/");
  const row = page.locator("#today li").first();
  const toggle = row.locator("button[aria-pressed]");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const goalId = sql(
    `select g.id from public.plan_goals g join public.daily_plans p on p.id = g.plan_id where g.user_id = '${USER_ID}' and g.kind = 'rack' order by p.day desc, g.sort limit 1`,
  );

  await context.setOffline(true);
  await toggle.click();
  await expect(page.getByText("Offline. 1 log saved on this phone; they sync when you reconnect.")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(sql(`select coalesce(result_tier, 'open') from public.plan_goals where id = '${goalId}'`)).toBe("open");

  await context.setOffline(false);
  await expect.poll(() => sql(`select coalesce(result_tier, 'open') from public.plan_goals where id = '${goalId}'`), { timeout: 15_000 }).not.toBe("open");
  await expect(page.getByText(/Offline\./)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("main screens have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/", "/overall", "/c/athletics", "/review", "/review/month", "/s/reading", "/s/strength", "/s/food", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    expect(serious, serious.join("\n")).toEqual([]);
  }
  await page.context().clearCookies();
  await page.goto("/login");
  const login = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(login.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
