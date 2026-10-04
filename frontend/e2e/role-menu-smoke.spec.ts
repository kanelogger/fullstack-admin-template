import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000001";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const now = "2026-10-02T10:00:00.000Z";

test("role permission replacement and menu CRUD use stable local route keys", async ({ page }) => {
  const permissions = [
    { key: "communication.messages.read", description: "读取消息" },
    { key: "administration.roles.read", description: "读取角色" },
    { key: "administration.roles.create", description: "创建角色" },
    { key: "administration.roles.update", description: "更新角色" },
    { key: "administration.roles.delete", description: "删除角色" },
    { key: "administration.roles.assign_permissions", description: "分配角色权限" },
    { key: "administration.menus.read", description: "读取菜单" },
    { key: "administration.menus.create", description: "创建菜单" },
    { key: "administration.menus.update", description: "更新菜单" },
    { key: "administration.menus.delete", description: "删除菜单" },
    { key: "administration.users.read", description: "读取用户" }
  ];
  let roles = [{
    id: "9007199254740993",
    code: "OPERATOR",
    name: "运营人员",
    description: "运营模块操作员",
    isSystem: true,
    isActive: true,
    userCount: 1,
    permissionKeys: ["administration.users.read"],
    createdAt: now,
    updatedAt: now
  }, {
    id: "9007199254740996",
    code: "SUPER_ADMIN",
    name: "超级管理员",
    description: "拥有全部管理权限",
    isSystem: true,
    isActive: true,
    userCount: 1,
    permissionKeys: permissions.map(permission => permission.key),
    createdAt: now,
    updatedAt: now
  }];
  let menus = [{
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
    createdAt: now,
    updatedAt: now
  }];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "admin",
    displayName: "系统管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "administration.roles.read",
      "administration.roles.create",
      "administration.roles.update",
      "administration.roles.delete",
      "administration.roles.assign_permissions",
      "administration.menus.read",
      "administration.menus.create",
      "administration.menus.update",
      "administration.menus.delete"
    ]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: "100",
        parentId: null,
        kind: "group",
        routeKey: null,
        path: "/system",
        title: "系统管理",
        icon: "SetUp",
        sortOrder: 10,
        requiredPermissionKey: null
      },
      {
        id: "101",
        parentId: "100",
        kind: "route",
        routeKey: "administration.roles",
        path: "/system/roles",
        title: "角色管理",
        icon: "UserFilled",
        sortOrder: 1,
        requiredPermissionKey: "administration.roles.read"
      },
      {
        id: "102",
        parentId: "100",
        kind: "route",
        routeKey: "administration.menus",
        path: "/system/menus",
        title: "菜单管理",
        icon: "Menu",
        sortOrder: 2,
        requiredPermissionKey: "administration.menus.read"
      }
    ])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({ status: 200, body: JSON.stringify(actorId) }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({ status: 200, headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" }, body: "[]" }));
  await page.route("**/rest/v1/permission_catalog**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(permissions.map(item => ({ permission_key: item.key, description: item.description }))) }));

  await page.route("**/rest/v1/rpc/admin_role_catalog", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ roles, permissions })
  }));
  await page.route("**/rest/v1/rpc/save_admin_role", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    rpcCalls.push({ name: "save_admin_role", args });
    const role = {
      id: String(args.p_role_id ?? "9007199254740995"),
      code: String(args.p_code),
      name: String(args.p_name),
      description: args.p_description as string | null,
      isSystem: false,
      isActive: Boolean(args.p_is_active),
      userCount: 0,
      permissionKeys: [],
      createdAt: now,
      updatedAt: now
    };
    roles = args.p_role_id
      ? roles.map(existing => existing.id === role.id ? { ...existing, ...role, permissionKeys: existing.permissionKeys } : existing)
      : [...roles, role];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(role) });
  });
  await page.route("**/rest/v1/rpc/replace_role_permissions", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    rpcCalls.push({ name: "replace_role_permissions", args });
    roles = roles.map(role => role.id === String(args.p_role_id)
      ? { ...role, permissionKeys: args.p_permission_keys as string[] }
      : role);
    return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.route("**/rest/v1/rpc/delete_admin_role", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    rpcCalls.push({ name: "delete_admin_role", args });
    roles = roles.filter(role => role.id !== String(args.p_role_id));
    return route.fulfill({ status: 204 });
  });
  await page.route("**/rest/v1/rpc/admin_menu_catalog", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(menus)
  }));
  await page.route("**/rest/v1/rpc/save_admin_menu", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    rpcCalls.push({ name: "save_admin_menu", args });
    const menu = {
      id: String(args.p_menu_id ?? "9007199254740996"),
      parentId: args.p_parent_id as string | null,
      kind: String(args.p_kind),
      routeKey: args.p_route_key as string | null,
      path: String(args.p_path),
      title: String(args.p_title),
      icon: args.p_icon as string | null,
      sortOrder: Number(args.p_sort_order),
      isVisible: Boolean(args.p_is_visible),
      isActive: Boolean(args.p_is_active),
      requiredPermissionKey: args.p_required_permission_key as string | null,
      createdAt: now,
      updatedAt: now
    };
    menus = args.p_menu_id
      ? menus.map(existing => existing.id === menu.id ? menu : existing)
      : [...menus, menu];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(menu) });
  });
  await page.route("**/rest/v1/rpc/delete_admin_menu", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    rpcCalls.push({ name: "delete_admin_menu", args });
    menus = menus.filter(menu => menu.id !== String(args.p_menu_id));
    return route.fulfill({ status: 204 });
  });

  await page.goto("/#/system/roles");
  await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible();
  await expect(page.getByText("OPERATOR", { exact: true })).toBeVisible();
  const superAdminRow = page.getByRole("row").filter({ hasText: "超级管理员" });
  await expect(superAdminRow.getByText("系统权限", { exact: true })).toBeVisible();
  await expect(superAdminRow.getByRole("button", { name: "权限" })).toHaveCount(0);
  await superAdminRow.getByRole("button", { name: "编辑" }).click();
  const superAdminDialog = page.getByRole("dialog");
  await expect(superAdminDialog.getByText("SUPER_ADMIN 必须保持启用。", { exact: true })).toBeVisible();
  await expect(superAdminDialog.getByLabel("角色启用")).toHaveCount(0);
  await superAdminDialog.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "新增角色" }).click();
  const roleDialog = page.getByRole("dialog");
  await roleDialog.getByLabel("角色编码").fill("SUPPORT_AGENT");
  await roleDialog.getByLabel("角色名称").fill("客服专员");
  await roleDialog.getByLabel("说明").fill("处理消息咨询");
  await roleDialog.getByRole("button", { name: "保存角色" }).click();
  await expect(page.getByText("客服专员", { exact: true })).toBeVisible();

  const roleRow = page.getByRole("row").filter({ hasText: "客服专员" });
  await roleRow.getByRole("button", { name: "权限" }).click();
  const permissionDialog = page.getByRole("dialog");
  await permissionDialog.getByRole("checkbox", { name: /communication\.messages\.read/ }).check();
  await permissionDialog.getByRole("button", { name: "保存权限" }).click();
  await expect(roleRow).toContainText("1");
  expect(rpcCalls.find(call => call.name === "replace_role_permissions")?.args).toMatchObject({
    p_role_id: "9007199254740995",
    p_permission_keys: ["communication.messages.read"]
  });

  await page.getByRole("link", { name: "菜单管理" }).click();
  await expect(page).toHaveURL(/#\/system\/menus$/);
  await expect(page.getByRole("heading", { name: "菜单管理" })).toBeVisible();
  await page.getByRole("button", { name: "新增菜单" }).click();
  const menuDialog = page.getByRole("dialog");
  await menuDialog.getByLabel("菜单名称").fill("客服工作台");
  await menuDialog.getByLabel("本地页面").selectOption("communication.messages");
  await menuDialog.getByLabel("路由地址").fill("/support/messages");
  await menuDialog.getByLabel("访问权限键").selectOption("communication.messages.read");
  await menuDialog.getByLabel("排序").fill("25");
  await menuDialog.getByRole("button", { name: "保存菜单" }).click();
  await expect(page.getByText("客服工作台", { exact: true })).toBeVisible();
  expect(rpcCalls.find(call => call.name === "save_admin_menu")?.args).toMatchObject({
    p_route_key: "communication.messages",
    p_path: "/support/messages",
    p_required_permission_key: "communication.messages.read"
  });
  expect(JSON.stringify(rpcCalls)).not.toContain("componentPath");
});
