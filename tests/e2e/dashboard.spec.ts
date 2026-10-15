import { expect, test } from "@playwright/test";
import { resetUser, signIn } from "./helpers";

test.describe("dashboard with real data", () => {
  test.beforeEach(async ({ page }) => {
    resetUser();
    await signIn(page);
  });

  test("renders banner, five categories, today's plan, and the archive at 390px", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    const banner = page.locator("header").first();
    await expect(banner.getByLabel(/^Overall score \d+$/)).toBeVisible();
    await expect(banner).toContainText(/Raw|Awakened|Forged|Ascendant|Sovereign/);

    for (const name of ["Business", "School", "Mind", "Athletics", "Nutrition"]) {
      await expect(page.locator(`section[aria-label="Categories"] a[href="/c/${name.toLowerCase()}"]`).last()).toContainText(name);
    }
    await expect(page.locator('section[aria-label="Categories"]')).toContainText("Lowest:");

    const today = page.locator("#today");
    await expect(today.getByRole("heading", { name: "Rack" })).toBeVisible();
    const rows = today.locator("li");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    await expect(today).toContainText("Store work");

    const archive = page.locator('section[aria-label="Skill archive"]');
    await expect(archive.getByRole("img", { name: /^Triathlon, dormant$/ })).toBeVisible();
    await expect(archive.getByRole("img", { name: /, score \d+$/ })).toHaveCount(14);

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

  test("archive filters narrow the shelves", async ({ page }) => {
    await page.goto("/");
    const archive = page.locator('section[aria-label="Skill archive"]');
    await archive.getByRole("button", { name: "Dormant" }).click();
    await expect(archive.getByRole("img")).toHaveCount(1);
    await archive.getByRole("button", { name: "Mind" }).click();
    await expect(archive.getByRole("img")).toHaveCount(4);
  });

  test("a category box opens its page with explainable scores", async ({ page }) => {
    await page.goto("/");
    await page.locator('section[aria-label="Categories"] > a[href="/c/athletics"]').click();
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
