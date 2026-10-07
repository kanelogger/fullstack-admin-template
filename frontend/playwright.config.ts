import { defineConfig, devices } from "@playwright/test";
import { playwrightArtifactDirectories } from "../scripts/playwright-artifacts.mjs";

const artifacts = playwrightArtifactDirectories(process.env.PLAYWRIGHT_ARTIFACT_SET ?? "adhoc");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI && process.env.VISUAL_BASELINE_RUN !== "1" ? 2 : 0,
  failOnFlakyTests: Boolean(process.env.CI && process.env.VISUAL_BASELINE_RUN !== "1"),
  outputDir: artifacts.outputDir,
  reporter: [["list"], ["html", { outputFolder: artifacts.htmlReport, open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8848",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/dashboard-visual.spec.ts",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "visual-linux",
      testMatch: "**/dashboard-visual.spec.ts",
      use: { ...devices["Desktop Chrome"], timezoneId: "Asia/Shanghai" }
    }
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 8848 --strictPort",
    url: "http://127.0.0.1:8848",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_PORT: "8848",
      VITE_PUBLIC_PATH: "/",
      VITE_ROUTER_HISTORY: "hash",
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "playwright-publishable-key"
    }
  }
});
