import { defineConfig, devices } from "@playwright/test";

const PORT = 3200; // tests/e2e/stack/config.mjs APP_PORT

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["iPhone 14"],
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "bash scripts/e2e-stack.sh",
    url: `http://localhost:${PORT}/login`,
    // Reuse a running stack only on request: another checkout's server would otherwise be picked up silently.
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
    // Let scripts/e2e-stack.sh stop Postgres and its children (a SIGKILL leaks them).
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
