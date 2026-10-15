import { expect, test } from "@playwright/test";
import { resetUser, signIn } from "./helpers";

// The service worker registers in production builds only: run with E2E_MODE=start.
test.skip(process.env.E2E_MODE !== "start", "needs a production build (E2E_MODE=start)");

test.beforeEach(async ({ page }) => {
  resetUser();
  await signIn(page);
});

test("installable: the manifest names the app and its icons", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as { name: string; display: string; icons: { src: string; purpose: string }[] };
  expect(m.display).toBe("standalone");
  expect(m.icons.map((i) => i.purpose)).toEqual(["any", "any", "maskable"]);
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("the service worker and offline page are served without a session", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  for (const path of ["/sw.js", "/offline.html", "/manifest.webmanifest"]) {
    const res = await anon.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }
  await anon.dispose();
});

test("after one online visit, the dashboard and offline page are cached on the device", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("#today li").first()).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A second online load goes through the now-active worker, which keeps a copy.
  await page.reload();
  await expect(page.locator("#today li").first()).toBeVisible();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Chromium's offline emulation does not cover the worker's own fetches, so check the caches directly.
  const cached = await page.evaluate(async () => {
    const pages = await caches.open("forge-pages-v1");
    const statics = await caches.open("forge-static-v1");
    const home = await pages.match("/");
    return { home: home ? (await home.text()).includes('id="today"') : false, offline: Boolean(await statics.match("/offline.html")) };
  });
  expect(cached).toEqual({ home: true, offline: true });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#today li").first()).toBeVisible();
  await expect(page.getByText("Offline. Logs you make now sync when you reconnect.")).toBeVisible();
  await context.setOffline(false);
});
