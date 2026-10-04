import { expect, test, type Page } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const businessUserId = "910000000000001";
const authUserId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";

async function prepareAuthenticatedShell(
  page: Page,
  options: { failUnreadCount?: boolean } = {}
) {
  let failUnreadCount = options.failUnreadCount ?? false;
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "shell-user",
    displayName: "测试用户",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "10",
          parentId: null,
          kind: "group",
          routeKey: null,
          path: "/operation",
          title: "运营管理",
          icon: "Operation",
          sortOrder: 20,
          requiredPermissionKey: null
        },
        {
          id: "11",
          parentId: "10",
          kind: "route",
          routeKey: "communication.messages",
          path: "/operation/messages",
          title: "消息中心",
          icon: "Message",
          sortOrder: 0,
          requiredPermissionKey: "communication.messages.read"
        }
      ])
    })
  );

  await page.route("**/rest/v1/rpc/current_business_user_id", route => {
    if (failUnreadCount) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "notification service unavailable" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(businessUserId)
    });
  });

  await page.route("**/rest/v1/messages**", route => {
    return route.fulfill({
      status: 200,
      headers: {
        "content-range": "*/0",
        "access-control-expose-headers": "content-range"
      },
      body: "[]"
    });
  });

  await page.route("**/rest/v1/message_read_model**", route =>
    route.fulfill({
      status: 200,
      headers: {
        "content-range": "*/0",
        "access-control-expose-headers": "content-range"
      },
      body: "[]"
    })
  );

  return {
    recoverUnreadCount() {
      failUnreadCount = false;
    }
  };
}

test("application shell keeps dynamic navigation, breadcrumbs, tags, search, and notification states", async ({ page }) => {
  await prepareAuthenticatedShell(page);
  await page.goto("/#/operation/messages");

  const primaryNav = page.getByRole("complementary", { name: "主导航" });
  await expect(primaryNav).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "消息中心" })).toBeVisible();

  await expect(page.getByRole("navigation", { name: "面包屑" })).toContainText("消息中心");
  await expect(page.getByRole("navigation", { name: "已打开页面" })).toContainText("消息中心");

  await page.getByRole("button", { name: "搜索菜单" }).click();
  const searchDialog = page.getByRole("dialog", { name: "搜索菜单" });
  await expect(searchDialog).toBeVisible();
  await searchDialog.getByRole("searchbox", { name: "搜索菜单" }).fill("消息");
  await expect(searchDialog.getByRole("button", { name: "消息中心" })).toBeVisible();
  await searchDialog.getByRole("button", { name: "消息中心" }).click();
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();

  await page.getByLabel("消息中心，0 条未读").click();
  const notifications = page.getByRole("region", { name: "消息通知" });
  await expect(notifications.getByRole("status")).toContainText("暂无未读消息");
  await page.getByRole("button", { name: "查看消息中心" }).click();
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
});

test("notification failure exposes a retry that recovers the empty state", async ({ page }) => {
  const shell = await prepareAuthenticatedShell(page, { failUnreadCount: true });
  await page.goto("/#/operation/messages");
  await page.getByLabel("消息中心，0 条未读").click();

  const notifications = page.getByRole("region", { name: "消息通知" });
  await expect(notifications.getByRole("alert")).toContainText("未读消息加载失败");
  shell.recoverUnreadCount();
  await notifications.getByRole("button", { name: "重试" }).click();
  await expect(notifications.getByRole("status")).toContainText("暂无未读消息");
});
