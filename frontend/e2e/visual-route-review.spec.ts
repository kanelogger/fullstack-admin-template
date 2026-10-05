import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000003";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const routes = [
  ["dashboard.overview", "/welcome", "dashboard.overview.read", "系统概览"],
  ["account.profile", "/profile/info", "identity.profile.read", "个人资料"],
  ["account.change-password", "/profile/change-password", "identity.profile.read", "重置密码"],
  ["communication.messages", "/operation/messages", "communication.messages.read", "消息中心"],
  ["operation.attachments", "/operation/attachments", "files.attachments.read", "附件管理"],
  ["administration.users", "/system/users", "administration.users.read", "用户管理"],
  ["administration.roles", "/system/roles", "administration.roles.read", "角色管理"],
  ["administration.menus", "/system/menus", "administration.menus.read", "菜单管理"],
  ["administration.departments", "/system/departments", "organization.departments.read", "部门管理"],
  ["administration.posts", "/system/posts", "organization.posts.read", "岗位管理"],
  ["administration.dictionaries", "/system/dicts", "configuration.dictionaries.read", "数据字典"],
  ["administration.configurations", "/system/configs", "configuration.system.read", "系统配置"],
  ["audit.login-logs", "/log/login-logs", "audit.logs.read", "登录日志"],
  ["audit.operation-logs", "/log/operation-logs", "audit.logs.read", "操作日志"],
  ["audit.exception-logs", "/log/exception-logs", "audit.logs.read", "异常日志"]
] as const;
const permissionKeys = [
  ...new Set([
    ...routes.map(([, , permission]) => permission),
    "identity.profile.update",
    "communication.messages.update",
    "files.attachments.upload",
    "files.attachments.delete",
    "administration.users.create",
    "administration.users.update",
    "administration.users.delete",
    "administration.users.reset_password",
    "administration.users.assign_roles",
    "administration.roles.create",
    "administration.roles.update",
    "administration.roles.delete",
    "administration.roles.assign_permissions",
    "administration.menus.create",
    "administration.menus.update",
    "administration.menus.delete",
    "organization.departments.create",
    "organization.departments.update",
    "organization.departments.delete",
    "organization.posts.create",
    "organization.posts.update",
    "organization.posts.delete",
    "configuration.dictionaries.create",
    "configuration.dictionaries.update",
    "configuration.dictionaries.delete",
    "configuration.system.update"
  ])
];
const dashboardOverview = {
  todoCount: 1,
  unreadMessageCount: 1,
  todoMessages: [],
  recentOperations: [],
  recentMessages: [],
  adminStats: { userCount: 3, roleCount: 2, menuCount: routes.length, todayLoginCount: 4, apiErrorCount: 0 }
};

async function saveVisual(page: Page, testInfo: TestInfo, name: string) {
  const outputDir = process.env.VISUAL_REVIEW_DIR;
  const path = outputDir
    ? join(outputDir, `${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  if (outputDir) await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

async function prepareVisualReview(page: Page) {
  await page.addInitScript(() => {
    const layout = new URL(location.href).searchParams.get("visualLayout");
    if (layout) localStorage.setItem("responsive-layout", JSON.stringify({ layout, sidebarStatus: true }));
  });
  await page.route("**/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").at(-1) ?? "";
    if (endpoint === "current_navigation") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
    body: JSON.stringify(routes.map(([routeKey, path, requiredPermissionKey], index) => ({
          id: String(index + 1),
          parentId: null,
          kind: "route",
          routeKey,
          path,
          title: routeKey === "dashboard.overview" ? "首页" : path.split("/").at(-1),
          icon: "HomeFilled",
          sortOrder: index,
          requiredPermissionKey
        })))
      });
    }
    if (endpoint === "current_business_user_id") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actorId) });
    }
    if (endpoint === "dashboard_overview") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardOverview) });
    }
    if (endpoint === "admin_roles_page") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ roles: [], permissions: [], menus: [], total: 0, page: 1, pageSize: 10 })
      });
    }
    if (endpoint === "admin_system_configurations") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 })
      });
    }
    if (endpoint === "admin_dictionary_types") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 10 })
      });
    }
    if (endpoint === "admin_dictionary_items" || endpoint === "dictionary_options" ||
      endpoint === "admin_menu_catalog" || endpoint === "admin_menu_permission_catalog") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
      body: "[]"
    });
  });
  await page.route("**/functions/v1/user-management", async route => {
    const action = route.request().postDataJSON()?.action;
    const data = action === "list"
      ? { items: [], total: 0, page: 1, pageSize: 10 }
      : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
  });
  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "visual-admin",
    displayName: "视觉验收管理员",
    roles: ["SUPER_ADMIN"],
    permissions: permissionKeys
  });
}

test("all registered PC pages render across every navigation layout and theme", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareVisualReview(page);

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const layout of ["vertical", "horizontal", "mix"] as const) {
      for (const [routeKey, path, , title] of routes) {
        await page.goto(`/?visualLayout=${layout}#${path}`);
        const shell = page.locator(".main-content");
        await expect(shell).toBeVisible();
        await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
        expect((await shell.innerText()).trim().length).toBeGreaterThan(0);
        await expect.poll(() => page.evaluate(() => document.body.getAttribute("layout"))).toBe(layout);
        await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
          .toBe(theme === "dark");
        if (layout !== "vertical") {
          const navLabel = layout === "horizontal" ? "主导航" : "一级导航";
          const navigation = page.getByRole("navigation", { name: navLabel });
          await expect(navigation).toBeVisible();
          const navMetrics = await navigation.evaluate(element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          }));
          expect(navMetrics.scrollWidth, `${navLabel} must expose overflow controls`).toBeGreaterThan(navMetrics.clientWidth);
          const activeMenuItem = navigation.locator(`a[href$="${path}"]`);
          await expect(activeMenuItem).toHaveCount(1);
          await expect(activeMenuItem).toBeInViewport({ ratio: 1 });
        }
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > window.innerWidth + 2
        );
        expect(overflow, `${routeKey} must keep page overflow inside its own panels (${theme}, ${layout})`).toBe(false);
        await page.waitForFunction(() => !document.querySelector(".fade-transform-enter-active"));
        await saveVisual(page, testInfo, `${theme}-${layout}-${routeKey.replaceAll(".", "-")}`);
        if (layout !== "vertical" && routeKey === "dashboard.overview") {
          const navLabel = layout === "horizontal" ? "主导航" : "一级导航";
          const navigation = page.getByRole("navigation", { name: navLabel });
          const initialScrollLeft = await navigation.evaluate(element => element.scrollLeft);
          await page.getByRole("button", { name: `向右滚动${navLabel}` }).click();
          await expect.poll(() => navigation.evaluate(element => element.scrollLeft))
            .toBeGreaterThan(initialScrollLeft);
          await expect(page.getByRole("button", { name: `向左滚动${navLabel}` })).toBeVisible();
          await page.getByRole("button", { name: `向左滚动${navLabel}` }).click();
          await expect.poll(() => navigation.evaluate(element => element.scrollLeft))
            .toBeLessThanOrEqual(initialScrollLeft + 1);
        }
      }
    }
  }
});
