import { expect, test } from "@playwright/test";
import { dashboardVisualCounts, installDashboardVisualFixture } from "./helpers/dashboard-visual-fixture";

async function compare(page: Parameters<typeof installDashboardVisualFixture>[0], name: string) {
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    scale: "css"
  });
}

test.describe("deterministic visual baselines", () => {
  test("login page light", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/#/login");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect(page.getByRole("heading", { name: "登录到工作台" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    await page.evaluate(() => document.fonts.ready);
    await compare(page, "login-light.png");
  });

  test("login page dark", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/#/login");
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(page.getByRole("heading", { name: "登录到工作台" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await compare(page, "login-dark.png");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`dashboard vertical ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await installDashboardVisualFixture(page, theme);
      await page.goto("/#/welcome");
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(theme === "dark");
      await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "待处理消息" })).toBeVisible();
      await expect(page.getByText("最近系统通知", { exact: true })).toBeVisible();
      await expect.poll(() => dashboardVisualCounts(page).rpcs.get("dashboard_overview")).toBe(1);
      await expect.poll(() => dashboardVisualCounts(page).rpcs.get("current_business_user_id") ?? 0).toBeGreaterThan(0);
      expect(dashboardVisualCounts(page).unexpected).toEqual([]);
      await page.evaluate(() => document.fonts.ready);
      await compare(page, `dashboard-vertical-${theme}.png`);
    });
  }
});
