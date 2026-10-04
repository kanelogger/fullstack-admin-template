import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const businessUserId = "910000000000001";
const authUserId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";

test("COMMON_USER restores Supabase navigation and receives 403 for an unauthorized direct route", async ({ page }) => {
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "common-user",
    displayName: "普通用户",
    roles: ["COMMON_USER"],
    permissions: [
      "identity.profile.read",
      "identity.profile.update",
      "communication.messages.read"
    ]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
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
      },
      {
        id: "17",
        parentId: null,
        kind: "group",
        routeKey: null,
        path: "/profile",
        title: "个人中心",
        icon: "User",
        sortOrder: 40,
        requiredPermissionKey: null
      },
      {
        id: "18",
        parentId: "17",
        kind: "route",
        routeKey: "account.profile",
        path: "/profile/info",
        title: "个人信息",
        icon: "UserFilled",
        sortOrder: 0,
        requiredPermissionKey: "identity.profile.read"
      },
      {
        id: "19",
        parentId: "17",
        kind: "route",
        routeKey: "account.change-password",
        path: "/profile/change-password",
        title: "修改密码",
        icon: "Lock",
        sortOrder: 1,
        requiredPermissionKey: "identity.profile.read"
      }
    ])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(businessUserId)
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/message_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  await page.goto("/#/operation/messages");
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  const navigation = page.getByRole("complementary", { name: "主导航" });
  await expect(navigation.getByRole("link", { name: "消息中心" })).toBeVisible();
  await navigation.getByLabel("个人中心").getByText("个人中心", { exact: true }).click();
  await expect(navigation.getByRole("link", { name: "个人信息" })).toBeVisible();
  await expect(navigation.getByText("首页", { exact: true })).toHaveCount(0);
  await expect(navigation.getByText("用户管理", { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await page.goto("/#/system/users");
  await expect(page.getByText("抱歉，你无权访问该页面", { exact: true })).toBeVisible();
});
