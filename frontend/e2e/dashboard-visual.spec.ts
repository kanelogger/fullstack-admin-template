import { expect, test } from "@playwright/test";
import { dashboardVisualCounts, installDashboardVisualFixture } from "./helpers/dashboard-visual-fixture";

async function compare(page: Parameters<typeof installDashboardVisualFixture>[0], name: string) {
  const options = {
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "css" as const,
    ...(process.env.VISUAL_STRICT_PIXEL_COMPARE === "1" ? { threshold: 0 } : {})
  };
  await expect(page).toHaveScreenshot(name, {
    ...options
  });
}

async function applyTheme(page: Parameters<typeof installDashboardVisualFixture>[0], theme: "light" | "dark") {
  await page.evaluate(isDark => document.documentElement.classList.toggle("dark", isDark), theme === "dark");
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

  for (const layout of ["vertical", "horizontal", "mix"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`dashboard ${layout} ${theme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await installDashboardVisualFixture(page, theme);
        await page.addInitScript(currentLayout => {
          localStorage.setItem("responsive-layout", JSON.stringify({ layout: currentLayout, sidebarStatus: true }));
        }, layout);
        await page.goto("/#/welcome");
        await applyTheme(page, theme);
        await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
          .toBe(theme === "dark");
        await expect.poll(() => page.evaluate(() => document.body.getAttribute("layout")), { timeout: 15_000 }).toBe(layout);
        await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "待处理消息" })).toBeVisible();
        await expect(page.getByText("最近系统通知", { exact: true })).toBeVisible();
        await expect.poll(() => dashboardVisualCounts(page).rpcs.get("dashboard_overview")).toBe(1);
        await expect.poll(() => dashboardVisualCounts(page).rpcs.get("current_business_user_id") ?? 0).toBeGreaterThan(0);
        expect(dashboardVisualCounts(page).unexpected).toEqual([]);
        await page.evaluate(() => document.fonts.ready);
        await compare(page, `dashboard-${layout}-${theme}.png`);
      });
    }
  }

  for (const theme of ["light", "dark"] as const) {
    test(`users table ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await installDashboardVisualFixture(page, theme);
      await page.goto("/#/system/users");
      await applyTheme(page, theme);
      await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "visual-operator" })).toContainText("林嘉宁");
      await page.evaluate(() => document.fonts.ready);
      await compare(page, `users-table-${theme}.png`);
    });

    test(`profile form ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await installDashboardVisualFixture(page, theme);
      await page.goto("/#/profile/info");
      await applyTheme(page, theme);
      await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
      await expect(page.getByLabel("姓名")).toHaveValue("视觉验收管理员");
      await page.evaluate(() => document.fonts.ready);
      await compare(page, `profile-form-${theme}.png`);
    });

    test(`role permission dialog ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await installDashboardVisualFixture(page, theme);
      await page.goto("/#/system/roles");
      await applyTheme(page, theme);
      await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible();
      const roleRow = page.getByRole("row").filter({ hasText: "OPERATOR" });
      await expect(roleRow).toBeVisible();
      await roleRow.getByRole("button", { name: "菜单与权限" }).click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: /角色权限/ })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await compare(page, `role-permission-${theme}.png`);
    });
  }
});
