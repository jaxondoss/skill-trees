import { expect, test } from "@playwright/test";
import { resetUser, sql } from "./helpers";
import { AUTH_COOKIE, USER_EMAIL, USER_ID, USER_PASSWORD } from "./stack/config.mjs";

const hasSession = async (page: import("@playwright/test").Page) =>
  (await page.context().cookies()).some((c) => c.name.startsWith(AUTH_COOKIE));

test.beforeEach(async ({ page }) => {
  resetUser();
  await page.context().clearCookies();
});

test("a visitor with no session gets the login screen, not the owner's data", async ({ page }) => {
  for (const path of ["/", "/board", "/settings", "/s/food", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  }
  expect(await hasSession(page)).toBe(false);
  await page.screenshot({ path: "test-results/login-390.png", fullPage: true });
});

test("API routes answer 401 with no session", async ({ request }) => {
  for (const path of ["/api/calendar?month=2026-11", "/api/export"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(401);
  }
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_EMAIL);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password did not match. Try again.");
  expect(await hasSession(page)).toBe(false);
  await page.screenshot({ path: "test-results/login-wrong-password-390.png", fullPage: true });
});

test("the right password opens the page that was asked for, and log out ends the session", async ({ page }) => {
  sql(`update public.profiles set onboarded_at = null where user_id = '${USER_ID}'`);
  await page.goto("/board");
  await expect(page).toHaveURL("http://localhost:3200/login?next=%2Fboard");
  await page.getByLabel("Email").fill(USER_EMAIL);
  await page.getByLabel("Password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("http://localhost:3200/board");
  await expect(page.locator("#today")).toBeVisible();
  expect(await hasSession(page)).toBe(true);
  expect(sql(`select onboarded_at is not null from public.profiles where user_id = '${USER_ID}'`)).toBe("t");
  await page.screenshot({ path: "test-results/login-success-board-390.png", fullPage: true });

  // Logged in, the login screen just goes back into the app.
  await page.goto("/login");
  await expect(page).toHaveURL("http://localhost:3200/");

  await page.goto("/settings");
  const account = page.getByRole("region", { name: "Account" });
  await expect(account).toContainText(`Logged in as ${USER_EMAIL}`);
  await page.screenshot({ path: "test-results/settings-account-390.png", fullPage: true });
  await account.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("http://localhost:3200/login");
  expect(await hasSession(page)).toBe(false);
  await page.goto("/board");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a login link cannot send you to another site", async ({ page }) => {
  await page.goto("/login?next=https://evil.example");
  await page.getByLabel("Email").fill(USER_EMAIL);
  await page.getByLabel("Password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("http://localhost:3200/");
});
