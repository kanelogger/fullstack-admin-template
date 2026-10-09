import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

test("PC error routes remain public without an application session", async ({ page }) => {
  const profileCalls: string[] = [];
  await page.route("**/rest/v1/rpc/current_profile", route => {
    profileCalls.push(route.request().url());
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "No session" }) });
  });

  await page.goto("/#/access-denied");
  await expect(page.getByText("抱歉，你无权访问该页面")).toBeVisible();

  await page.goto("/#/server-error");
  await expect(page.getByText("500").first()).toBeVisible();

  await page.goto("/#/unknown-page");
  await expect(page.getByText("抱歉，你访问的页面不存在")).toBeVisible();
  expect(profileCalls).toHaveLength(0);
});

test("login page keeps account/password as its only sign-in method", async ({ page }) => {
  await page.goto("/#/login");

  await expect(page.getByRole("heading", { name: "登录到工作台" })).toBeVisible();
  const loginForm = page.locator("form");
  await expect(loginForm).toHaveCount(1);
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  await expect(page.getByLabel("账号")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(loginForm.getByRole("button", { name: "登录" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "忘记密码？" })).toBeVisible();
  await expect(loginForm.locator(
    'input[type="email"], input[type="tel"], input[autocomplete="one-time-code"]'
  )).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(
    /短信|邮箱验证码|魔法链接|第三方登录|单点登录|扫码登录|Passkey|Google 登录|GitHub 登录/i
  )).toHaveCount(0);
});

test("user creation opens the email reset form without a password input", async ({ page }) => {
  const businessUserId = "910000000000131";
  const authUserId = "9f9619ff-8b86-4011-b42d-00cf4fc964ff";
  const existingUser = {
    id: "9007199254740993",
    userCode: "E-100",
    loginName: "employee-100",
    displayName: "员工一百",
    email: "user100@example.test",
    phone: null,
    departmentId: "9007199254740994",
    postId: null,
    isActive: true,
    roles: [{ id: "2", code: "COMMON_USER", name: "普通用户", isActive: true }],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z"
  };
  let users = [existingUser];
  const actions: string[] = [];
  let nativeDialogCount = 0;
  page.on("dialog", dialog => { nativeDialogCount++; void dialog.dismiss(); });
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "admin",
    displayName: "超级管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "administration.users.read",
      "administration.users.create",
      "administration.users.delete",
      "administration.users.assign_roles",
      "organization.departments.read",
      "organization.posts.read"
    ]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "10",
      parentId: null,
      kind: "group",
      routeKey: null,
      path: "/system",
      title: "系统管理",
      icon: "SetUp",
      sortOrder: 10,
      requiredPermissionKey: null
    }, {
      id: "11",
      parentId: "10",
      kind: "route",
      routeKey: "administration.users",
      path: "/system/users",
      title: "用户管理",
      icon: "UserFilled",
      sortOrder: 1,
      requiredPermissionKey: "administration.users.read"
    }])
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
  await page.route("**/rest/v1/department_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "0-0/1", "access-control-expose-headers": "content-range" },
    contentType: "application/json",
    body: JSON.stringify([{
      id: "9007199254740994",
      parent_id: null,
      dept_code: "ENG",
      dept_name: "工程部",
      status: 1,
      description: null,
      created_at: "2026-10-02T00:00:00.000Z",
      updated_at: "2026-10-02T00:00:00.000Z"
    }])
  }));
  await page.route("**/rest/v1/post_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/functions/v1/user-management", async route => {
    const action = route.request().postDataJSON()?.action;
    actions.push(action);
    let data: unknown;
    if (action === "roles") data = [{ id: "2", code: "COMMON_USER", name: "普通用户" }];
    else if (action === "list") data = { items: users, total: users.length, page: 1, pageSize: 10 };
    else if (action === "delete") {
      users = users.filter(user => user.id !== route.request().postDataJSON()?.id);
      data = { id: route.request().postDataJSON()?.id, deleted: true };
    }
    if (data === null) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Unexpected test action" } })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
  });

  await page.goto("/#/system/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  const existingRow = page.getByRole("row").filter({ hasText: "employee-100" });
  await expect(existingRow).toContainText("工程部 / —");
  await expect(existingRow).toContainText("员工一百");
  await page.getByRole("button", { name: "新增用户" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("邮箱")).toBeVisible();
  await expect(dialog.getByLabel("密码")).toHaveCount(0);
  await expect(dialog.getByText("邮箱用于接收密码重置邮件，不作为登录名。", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "普通用户" }).check();
  await expect(dialog.getByRole("checkbox", { name: "普通用户" })).toBeChecked();
  await dialog.getByLabel("部门").selectOption("9007199254740994");
  await expect(dialog.getByLabel("部门")).toHaveValue("9007199254740994");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "新增用户" })).toBeFocused();
  const deleteButton = existingRow.getByRole("button", { name: "删除" });
  await deleteButton.click();
  const confirmation = page.getByRole("alertdialog", { name: "确认操作" });
  await expect(confirmation).toContainText("员工一百");
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(existingRow).toHaveCount(1);
  expect(actions).not.toContain("delete");
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  expect(actions).not.toContain("delete");
  await deleteButton.click();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(existingRow).toHaveCount(0);
  await expect.poll(() => actions.filter(action => action === "delete").length).toBe(1);
  expect(nativeDialogCount).toBe(0);
});

test("role members dialog renders the returned user identity", async ({ page }) => {
  const now = "2026-10-08T00:00:00.000Z";
  await installSupabaseSessionMock(page, {
    userId: "910000000000141",
    authUserId: "af9619ff-8b86-4011-b42d-00cf4fc964ff",
    loginName: "role-auditor",
    displayName: "角色验收管理员",
    roles: ["SUPER_ADMIN"],
    permissions: ["administration.roles.read", "administration.users.read"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "20",
      parentId: null,
      kind: "group",
      routeKey: null,
      path: "/system",
      title: "系统管理",
      icon: "SetUp",
      sortOrder: 10,
      requiredPermissionKey: null
    }, {
      id: "21",
      parentId: "20",
      kind: "route",
      routeKey: "administration.roles",
      path: "/system/roles",
      title: "角色管理",
      icon: "UserFilled",
      sortOrder: 1,
      requiredPermissionKey: "administration.roles.read"
    }])
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/rpc/admin_roles_page", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      roles: [{
        id: "9007199254740993",
        code: "OPERATOR",
        name: "运营人员",
        description: null,
        isSystem: true,
        isActive: true,
        userCount: 1,
        permissionKeys: [],
        createdAt: now,
        updatedAt: now
      }],
      permissions: [],
      menus: [],
      total: 1,
      page: 1,
      pageSize: 10
    })
  }));
  await page.route("**/rest/v1/rpc/admin_role_members", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: [{ id: "910000000000001", userCode: "ADMIN-001", loginName: "admin", displayName: "系统管理员", isActive: true }],
      total: 1,
      page: 1,
      pageSize: 10
    })
  }));

  await page.goto("/#/system/roles");
  const roleRow = page.getByRole("row").filter({ hasText: "运营人员" });
  await roleRow.getByRole("button", { name: "成员" }).click();
  const dialog = page.getByRole("dialog", { name: /角色成员/ });
  await expect(dialog.getByText("系统管理员", { exact: true })).toBeVisible();
});

test("menu role editor reflects authorized roles from the current catalog", async ({ page }) => {
  await installSupabaseSessionMock(page, {
    userId: "910000000000151",
    authUserId: "bf9619ff-8b86-4011-b42d-00cf4fc964ff",
    loginName: "menu-auditor",
    displayName: "菜单验收管理员",
    roles: ["SUPER_ADMIN"],
    permissions: ["administration.menus.read", "administration.roles.read", "administration.roles.assign_permissions"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "30",
      parentId: null,
      kind: "group",
      routeKey: null,
      path: "/system",
      title: "系统管理",
      icon: "SetUp",
      sortOrder: 10,
      requiredPermissionKey: null
    }, {
      id: "31",
      parentId: "30",
      kind: "route",
      routeKey: "administration.menus",
      path: "/system/menus",
      title: "菜单管理",
      icon: "Menu",
      sortOrder: 2,
      requiredPermissionKey: "administration.menus.read"
    }])
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/rpc/admin_menu_catalog", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "9007199254740994",
      parentId: null,
      kind: "route",
      routeKey: "administration.roles",
      path: "/system/roles",
      title: "角色管理",
      icon: null,
      sortOrder: 10,
      isVisible: true,
      isActive: true,
      requiredPermissionKey: "administration.roles.read",
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z"
    }])
  }));
  await page.route("**/rest/v1/rpc/admin_menu_permission_catalog", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/rest/v1/rpc/menu_role_catalog", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      permissionKey: "administration.roles.read",
      sharedMenuCount: 1,
      roles: [{
        id: "9007199254740995",
        code: "SUPPORT_AGENT",
        name: "客服专员",
        isActive: true,
        isSystem: false,
        authorized: true
      }]
    })
  }));

  await page.goto("/#/system/menus");
  const menuRow = page.getByRole("row").filter({ hasText: "角色管理" });
  await menuRow.getByRole("button", { name: "授权角色" }).click();
  const dialog = page.getByRole("dialog", { name: /菜单授权角色/ });
  await expect(dialog.getByRole("checkbox", { name: /客服专员/ })).toBeChecked();
});

test("an authenticated custom RouteKey path resolves after a direct load and browser refresh", async ({ page }) => {
  const businessUserId = "910000000000111";
  const authUserId = "7f9619ff-8b86-4011-b42d-00cf4fc964ff";
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "custom-route-user",
    displayName: "自定义路由用户",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "22",
      parentId: null,
      kind: "route",
      routeKey: "communication.messages",
      path: "/ops/inbox",
      title: "收件箱",
      icon: "Message",
      sortOrder: 0,
      requiredPermissionKey: "communication.messages.read"
    }])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(businessUserId)
  }));
  await page.route("**/rest/v1/message_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  await page.goto("/#/ops/inbox");
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await expect(page.getByRole("link", { name: "收件箱" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await expect(page.getByRole("link", { name: "收件箱" })).toBeVisible();
});

test("local sign-out reports an unconfirmed server revoke instead of treating it as success", async ({ page }) => {
  const businessUserId = "910000000000121";
  const authUserId = "8f9619ff-8b86-4011-b42d-00cf4fc964ff";
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "revoke-failure-user",
    displayName: "撤销失败用户",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "23",
      parentId: null,
      kind: "route",
      routeKey: "communication.messages",
      path: "/operation/messages",
      title: "消息中心",
      icon: "Message",
      sortOrder: 0,
      requiredPermissionKey: "communication.messages.read"
    }])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(businessUserId)
  }));
  await page.route("**/rest/v1/rpc/revoke_account_password_session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "false"
  }));
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204, body: "" }));
  await page.route("**/rest/v1/message_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  await page.goto("/#/operation/messages");
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await page.getByLabel("用户菜单：撤销失败用户").click();
  await page.getByRole("menuitem", { name: "退出系统" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page.getByText("本机已退出，但服务端未确认撤销会话；请检查网络后重新登录。"))
    .toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).toBeNull();
});

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
