import { defineConfig } from "@playwright/test";

// Local-only cross-tab smoke tests (`npm run test:browser`). They are not part of `npm test` or CI.
const port = Number(process.env.VEIL_E2E_PORT ?? 3123);
// Set when Chromium is not installed through Playwright (`npx playwright install chromium`).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // Each test gets a fresh browser context, so IndexedDB and localStorage start empty and never touch real data.
  webServer: {
    command: `npm run build && npm run start -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    // Never reuse a running server: it may be an older build, and the test would then pass against the wrong code.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
