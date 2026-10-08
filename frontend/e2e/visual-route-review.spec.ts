import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000003";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const pageHeadingByRouteKey = {
  "dashboard.overview": "系统概览",
  "account.profile": "个人资料",
  "account.change-password": "重置密码",
  "communication.messages": "消息中心",
  "operation.attachments": "附件管理",
  "administration.users": "用户管理",
  "administration.roles": "角色管理",
  "administration.menus": "菜单管理",
  "administration.departments": "部门管理",
  "administration.posts": "岗位管理",
  "administration.dictionaries": "数据字典",
  "administration.configurations": "系统配置",
  "audit.login-logs": "登录日志",
  "audit.operation-logs": "操作日志",
  "audit.exception-logs": "异常日志"
} as const;

type RegisteredRoute = {
  routeKey: keyof typeof pageHeadingByRouteKey;
  path: string;
  permission: string;
  title: string;
  icon: string;
  pageHeading: string;
};

async function registeredRoutes(): Promise<RegisteredRoute[]> {
  const source = await readFile(new URL("../src/features/menus/menu-routes.registry.ts", import.meta.url), "utf8");
  const seed = await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  const block = source.match(/export const registeredMenuRoutes:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1];
  if (!block) throw new Error("Could not read registered RouteKey metadata for the layout matrix");
  const seedMenus = new Map([...seed.matchAll(/\(\s*\d+,\s*(?:null|\d+),\s*'route',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/g)]
    .map(([, routeKey, path, title, icon]) => [routeKey, { path, title, icon }]));
  const routes = [...block.matchAll(/routeKey:\s*"([^"]+)"[^\n]*label:\s*"([^"]+)"[^\n]*defaultPath:\s*"([^"]+)"[^\n]*requiredPermissionKey:\s*"([^"]+)"/g)]
    .map(([, routeKey, , path, permission]) => {
      const seeded = seedMenus.get(routeKey);
      if (!seeded || seeded.path !== path) throw new Error(`Route ${routeKey} is missing matching seed metadata`);
      const pageHeading = pageHeadingByRouteKey[routeKey as keyof typeof pageHeadingByRouteKey];
      if (!pageHeading) throw new Error(`Route ${routeKey} has no expected page heading`);
      return { routeKey: routeKey as keyof typeof pageHeadingByRouteKey, path, permission, title: seeded.title, icon: seeded.icon, pageHeading };
    });
  if (routes.length === 0) throw new Error("The layout matrix requires at least one registered RouteKey");
  const routeKeys = new Set(routes.map(route => route.routeKey));
  const unmapped = Object.keys(pageHeadingByRouteKey).filter(routeKey => !routeKeys.has(routeKey as keyof typeof pageHeadingByRouteKey));
  if (unmapped.length) throw new Error(`Expected page headings contain unregistered RouteKeys: ${unmapped.join(", ")}`);
  return routes;
}

const additionalPermissionKeys = [
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
];

async function prepareVisualReview(page: Page, routes: RegisteredRoute[]) {
  const unexpectedRequests: string[] = [];
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
        body: JSON.stringify(routes.map(({ routeKey, path, permission, title, icon }, index) => ({
          id: String(index + 1),
          parentId: null,
          kind: "route",
          routeKey,
          path,
          title,
          icon,
          sortOrder: index,
          requiredPermissionKey: permission
        })))
      });
    }
    if (endpoint === "current_business_user_id") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actorId) });
    }
    if (endpoint === "dashboard_overview") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          todoCount: 1,
          unreadMessageCount: 1,
          todoMessages: [],
          recentOperations: [],
          recentMessages: [],
          adminStats: { userCount: 3, roleCount: 2, menuCount: routes.length, todayLoginCount: 4, apiErrorCount: 0 }
        })
      });
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
    if (url.pathname.includes("/rpc/")) {
      unexpectedRequests.push(`${route.request().method()} ${url.pathname}`);
      return route.abort("failed");
    }
    const readModels = new Set([
      "message_read_model",
      "department_read_model",
      "post_read_model",
      "login_log_read_model",
      "operation_log_read_model",
      "exception_log_read_model",
      "attachment_read_model"
    ]);
    if (readModels.has(endpoint) && ["GET", "HEAD"].includes(route.request().method())) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
        body: route.request().method() === "HEAD" ? "" : "[]"
      });
    }
    if (endpoint === "messages" && ["GET", "HEAD"].includes(route.request().method())) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
        body: route.request().method() === "HEAD" ? "" : "[]"
      });
    }
    unexpectedRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.abort("failed");
  });
  await page.route("**/functions/v1/user-management", async route => {
    const action = route.request().postDataJSON()?.action;
    const data = action === "list"
      ? { items: [], total: 0, page: 1, pageSize: 10 }
      : [];
    if (["list", "roles"].includes(action)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
    }
    unexpectedRequests.push(`POST /functions/v1/user-management action=${String(action)}`);
    return route.abort("failed");
  });
  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "visual-admin",
    displayName: "视觉验收管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [...new Set([...routes.map(route => route.permission), ...additionalPermissionKeys])]
  });
  return unexpectedRequests;
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await mkdir(testInfo.outputDir, { recursive: true });
  await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true }).catch(() => undefined);
});

test("all registered PC pages render across every navigation layout and theme", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const routes = await registeredRoutes();
  const unexpectedRequests = await prepareVisualReview(page, routes);

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const layout of ["vertical", "horizontal", "mix"] as const) {
      for (const { routeKey, path, pageHeading } of routes) {
        await page.goto(`/?visualLayout=${layout}#${path}`);
        const shell = page.locator(".main-content");
        await expect(shell).toBeVisible();
        await expect(shell.getByRole("heading", { name: pageHeading, exact: true }),
          `${routeKey} must render its registered page heading`).toBeVisible();
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
  expect(unexpectedRequests).toEqual([]);
});
