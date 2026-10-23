import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  workers: 1,
  timeout: 30000,
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/ui-fixture.ts",
    url: "http://127.0.0.1:4179/health",
    timeout: 30000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
