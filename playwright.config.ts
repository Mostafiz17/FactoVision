import { defineConfig } from "@playwright/test";

/**
 * E2E suite. Requires Playwright browsers (`npx playwright install chromium`)
 * and a built app; the webServer block starts `npm run start` (or reuses a
 * running preview). Seeded demo credentials are used.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});