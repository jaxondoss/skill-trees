import { expect, test } from "@playwright/test";
import { resetUser, signIn, sql } from "./helpers";
import { USER_ID } from "./stack/config.mjs";

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("an unstarted assignment due within 48 hours becomes today's Academics goal", async ({ page }) => {
  await page.goto("/s/academics");
  await page.getByLabel("Course").fill("CMPS");
  await page.getByLabel("Assignment", { exact: true }).fill("Lab 6");
  const due = new Date(Date.now() + 24 * 3_600_000);
  const local = new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Due").fill(local);
  await page.getByRole("region", { name: "Assignments" }).getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("CMPS: Lab 6")).toBeVisible();
  await expect(page.getByText(", within 48 hours")).toBeVisible();

  // Today's plan is generated on the next open of the dashboard.
  sql(`delete from public.daily_plans where user_id = '${USER_ID}'`);
  await page.goto("/");
  await expect(page.locator("#today")).toContainText("Start CMPS: Lab 6");
});

test("one-tap sleep, gut rating, and meal quick-add", async ({ page }) => {
  await page.goto("/s/sleep");
  await expect(page.getByText(/Tonight's anchor: \d+:\d\d AM/)).toBeVisible();
  await page.getByRole("button", { name: "Going to sleep" }).click();
  await expect(page.getByRole("button", { name: "Awake" })).toBeEnabled();
  await page.getByRole("button", { name: "Awake" }).click();
  await expect(page.getByRole("region", { name: "Sleep log" }).locator("li")).toHaveCount(1);

  await page.goto("/s/gut-health");
  await page.getByRole("group", { name: /How do you feel today/ }).getByRole("button", { name: "4" }).click();
  await expect(page.getByRole("group", { name: /How do you feel today/ }).getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/s/food");
  const fuel = page.getByRole("region", { name: "Today's fuel" });
  await fuel.getByLabel("Calories").fill("900");
  await fuel.getByLabel("Protein grams").fill("60");
  await fuel.getByLabel("Fiber grams").fill("12");
  await page.getByRole("region", { name: "Today's fuel" }).getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("region", { name: "Today's fuel" })).toContainText("900 / 3500");
  await expect(page.getByRole("region", { name: "Today's fuel" })).toContainText("60 g / 200 g");
});

test("the meditation timer ends with a bell and completes today's goal", async ({ page }) => {
  // Pin Meditation so today's plan has a meditation goal.
  sql(`update public.rack_pins set skill_id = (select id from public.skills where user_id = '${USER_ID}' and slug = 'meditation') where user_id = '${USER_ID}' and slot = 5`);
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("#today")).toContainText("Sit");
  await page.goto("/s/meditation");
  await page.getByRole("button", { name: "3 min" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("region", { name: "Sit" }).getByText(/^[23]:\d\d$/)).toBeVisible();
  await page.clock.fastForward(3 * 60_000 + 1000);
  await expect(page.getByText("Sat 3 minutes. Logged.")).toBeVisible();
  await page.goto("/");
  const row = page.locator("#today li", { hasText: "Sit" }).first();
  await expect(row.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
  await expect(row).toContainText("Floor");
});

test("the WOOP flow saves to the Visualization log", async ({ page }) => {
  await page.goto("/s/visualization");
  const steps = ["Finish the half under 1:45", "Crossing the line strong", "I skip long runs when tired", "If I feel tired, then I run the first mile anyway"];
  for (const [i, text] of steps.entries()) {
    await page.getByRole("textbox", { name: ["Wish", "Outcome", "Obstacle", "Plan"][i] }).fill(text);
    await page.getByRole("button", { name: i < 3 ? "Next" : "Save", exact: true }).click();
  }
  await expect(page.getByText("WOOP saved to the log.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Log" })).toContainText("WOOP. Wish: Finish the half under 1:45");
});

test("chess connect records an honest failure when the provider cannot be reached, and disconnects", async ({ page }) => {
  await page.goto("/s/chess");
  await page.getByLabel("Chess username").fill("jaxon_d");
  await page.getByRole("button", { name: "Connect" }).click();
  // The test stack has no internet access, so the first sync fails and says so.
  await expect(page.getByText(/Last sync failed/)).toBeVisible();
  await expect(page.getByText(/Syncing jaxon_d on lichess, rapid/)).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
});

test("settings lists every integration with what it needs and its manual fallback", async ({ page }) => {
  await page.goto("/settings");
  const list = page.getByRole("region", { name: "Integrations" });
  await expect(list.locator("li")).toHaveCount(5);
  await expect(list).toContainText("Lifta's API documentation");
  await expect(list).toContainText("Canvas personal access token");
  await expect(list.getByRole("link", { name: "Add assignments on the Academics page" })).toHaveAttribute("href", "/s/academics");
});
