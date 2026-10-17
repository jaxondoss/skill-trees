import { expect, test } from "@playwright/test";
import { resetUser, signIn } from "./helpers";

test.describe("dashboard with real data", () => {
  test.beforeEach(async ({ page }) => {
    resetUser();
    await signIn(page);
  });

  test("renders the statue, five categories, today's plan, skills and numbers at 390px", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    const hero = page.locator('section[aria-label="The statue"]');
    await expect(hero).toContainText(/Raw|Awakened|Forged|Ascendant|Sovereign/);
    for (const name of ["Business", "School", "Mind", "Athletics", "Nutrition"]) {
      await expect(hero.locator(`a[href="/c/${name.toLowerCase()}"]`)).toContainText(name);
    }

    const today = page.locator("#today");
    await expect(today.getByRole("heading", { name: "Rack" })).toBeVisible();
    const rows = today.locator("li");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    await expect(today).toContainText("Store work");

    const skills = page.locator("a[data-skill-tile]");
    await expect(skills).toHaveCount(15);
    await expect(page.getByRole("link", { name: /^Triathlon, dormant\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bodyweight: / })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);

    await page.screenshot({ path: "test-results/dashboard-390.png", fullPage: true });
  });

  test("creates today's plan once: reloading does not duplicate goals", async ({ page }) => {
    await page.goto("/");
    const first = await page.locator("#today li").count();
    await page.reload();
    await expect(page.locator("#today li")).toHaveCount(first);
  });

  test("the Today ring jumps to the checklist", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Jump to today's goals/ }).click();
    await expect(page.locator("#today")).toBeInViewport();
  });

  test("a number tile is its own input", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Bodyweight: / }).click();
    const input = page.getByLabel("Bodyweight");
    await input.fill("184.2");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: /^Bodyweight: 184\.2\./ })).toBeVisible();
  });

  test("a skill tile opens its page", async ({ page }) => {
    await page.goto("/");
    await page.locator("a[data-skill-tile]", { hasText: "Strength" }).click();
    await expect(page).toHaveURL(/\/s\/strength$/);
  });

  test("a category box opens its page with explainable scores", async ({ page }) => {
    await page.goto("/");
    await page.locator('section[aria-label="The statue"] a[href="/c/athletics"]').click();
    await expect(page).toHaveURL(/\/c\/athletics$/);
    await expect(page.getByRole("heading", { name: "Athletics" })).toBeVisible();
    await expect(page.getByText("Dormant. Not counted in scores or goals.")).toBeVisible();
    await expect(page.getByText(/Level \d+, Consistency \d+/).first()).toBeVisible();
    await page.screenshot({ path: "test-results/category-athletics-390.png", fullPage: true });
  });
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
