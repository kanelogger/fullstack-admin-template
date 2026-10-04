import { expect, test, type Page } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000003";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";

async function prepareDashboardPage(page: Page) {
  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "admin",
    displayName: "超级管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "dashboard.overview.read",
      "audit.logs.read",
      "administration.users.read",
      "administration.roles.read",
      "administration.menus.read"
    ]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "1",
      parentId: null,
      kind: "route",
      routeKey: "dashboard.overview",
      path: "/welcome",
      title: "首页",
      icon: "HomeFilled",
      sortOrder: 0,
      requiredPermissionKey: "dashboard.overview.read"
    }])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(actorId)
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
}

const overview = {
  todoCount: 0,
  unreadMessageCount: 2,
  recentOperations: [{
    id: "9007199254740993",
    operatorName: "超级管理员",
    moduleCode: "USER",
    operationType: "UPDATE",
    requestParams: { recordId: "9007199254740994" },
    operationResult: 1,
    operatedAt: "2026-10-02T10:00:00.000Z"
  }],
  announcements: [{
    id: "9007199254740995",
    title: "系统维护通知",
    summary: "本周末例行维护",
    messageType: "ANNOUNCEMENT",
    readStatus: false,
    sentAt: "2026-10-02T09:00:00.000Z"
  }],
  adminStats: {
    userCount: 3,
    roleCount: 2,
    menuCount: 5,
    todayLoginCount: 4,
    apiErrorCount: 1
  }
};

test("dashboard reads scoped Supabase overview data and exact text IDs", async ({ page }) => {
  await prepareDashboardPage(page);
  const calls: string[] = [];
  await page.route("**/rest/v1/rpc/dashboard_overview", async route => {
    calls.push("dashboard_overview");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) });
  });

  await page.goto("/#/welcome");
  await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
  await expect(page.getByText("系统维护通知", { exact: true })).toBeVisible();
  await expect(page.getByText("USER / UPDATE", { exact: true })).toBeVisible();
  await expect(page.getByText("9007199254740994", { exact: true })).toHaveCount(0);
  await expect(page.getByText("今日登录").locator("xpath=.." )).toContainText("4");
  await expect(page.getByText("用户数").locator("xpath=.." )).toContainText("3");
  expect(calls).toEqual(["dashboard_overview"]);
});

test("dashboard exposes a retry when the Supabase overview request fails", async ({ page }) => {
  await prepareDashboardPage(page);
  let calls = 0;
  await page.route("**/rest/v1/rpc/dashboard_overview", async route => {
    calls += 1;
    if (calls === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "temporary failure" })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) });
  });

  await page.goto("/#/welcome");
  await expect(page.getByRole("heading", { name: "首页数据加载失败" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("系统维护通知", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});
