import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: "http://127.0.0.1:4175", reducedMotion: "reduce" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    env: { PORT: "4175" },
  },
});
