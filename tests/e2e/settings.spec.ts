import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  sql(`delete from public.day_overrides where user_id = '${USER_ID}'; update public.profiles set daily_budget_min = 125 where user_id = '${USER_ID}'`);
  await signIn(page);
});

test.afterEach(() => {
  sql(`delete from public.day_overrides where user_id = '${USER_ID}'; update public.profiles set daily_budget_min = 125 where user_id = '${USER_ID}'`);
});

test("settings change the budget, and a sick-day override rebuilds an untouched plan", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#today li").first()).toBeVisible();

  await page.goto("/settings");
  const general = page.getByRole("region", { name: "General" });
  await general.getByLabel("Daily skill time").fill("150");
  await general.getByRole("button", { name: "Save" }).click();
  await expect(general.getByText("Saved.")).toBeVisible();
  expect(sql(`select daily_budget_min from public.profiles where user_id = '${USER_ID}'`)).toBe("150");

  const today = sql(`select ((now() at time zone 'America/Chicago') - interval '4 hours')::date`);
  const overrides = page.getByRole("region", { name: "Day overrides" });
  await overrides.getByLabel("Override", { exact: true }).selectOption("sick");
  await overrides.getByLabel("Override starts").fill(today);
  await overrides.getByLabel("Override ends").fill(today);
  await overrides.getByRole("button", { name: "Add override" }).click();
  await expect(overrides.getByText("Added. Use Rebuild if it starts today.")).toBeVisible();

  await page.getByRole("button", { name: "Rebuild today's plan with these settings" }).click();
  await expect(page.getByText("Today's plan will rebuild on the dashboard.")).toBeVisible();
  await page.goto("/board");
  await expect(page.locator("#today")).toContainText("Sick day");
});

test("export downloads every table without encrypted secrets", async ({ page }) => {
  await page.goto("/settings");
  const res = await page.request.get("/api/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="forge-export-\d{4}-\d{2}-\d{2}\.json"/);
  const body = await res.text();
  const json = JSON.parse(body) as { tables: Record<string, unknown[]> };
  expect(json.tables.skills!.length).toBeGreaterThanOrEqual(15);
  expect(Object.keys(json.tables)).toEqual(expect.arrayContaining(["weekly_reviews", "monthly_reviews", "metrics", "plan_goals"]));
  expect(body).not.toContain("secret_ciphertext");
});

test("look and feel is saved on this device", async ({ page }) => {
  await page.goto("/settings");
  const look = page.getByRole("region", { name: "Look and feel" });
  await look.getByRole("group", { name: "Background" }).getByRole("button", { name: "Still" }).click();
  await look.getByRole("group", { name: "Power-up" }).getByRole("button", { name: "Calm" }).click();
  await page.reload();
  await expect(look.getByRole("group", { name: "Background" }).getByRole("button", { name: "Still" })).toHaveAttribute("aria-pressed", "true");
  await expect(look.getByRole("group", { name: "Power-up" }).getByRole("button", { name: "Calm" })).toHaveAttribute("aria-pressed", "true");
});
