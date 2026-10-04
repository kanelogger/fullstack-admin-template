import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000003";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";

test("user administration manages accounts and sends password resets", async ({ page }) => {
  const roles = [
    { id: "2", code: "COMMON_USER", name: "普通用户" },
    { id: "3", code: "OPERATOR", name: "运营人员" },
    { id: "1", code: "SUPER_ADMIN", name: "超级管理员" }
  ];
  let users = [
    {
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
    }
  ];
  const actions: string[] = [];

  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "admin",
    displayName: "超级管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "administration.users.read",
      "administration.users.create",
      "administration.users.update",
      "administration.users.delete",
      "administration.users.assign_roles",
      "administration.users.reset_password",
      "organization.departments.read",
      "organization.posts.read"
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
        path: "/system",
        title: "系统管理",
        icon: "SetUp",
        sortOrder: 10,
        requiredPermissionKey: null
      },
      {
        id: "11",
        parentId: "10",
        kind: "route",
        routeKey: "administration.users",
        path: "/system/users",
        title: "用户管理",
        icon: "UserFilled",
        sortOrder: 1,
        requiredPermissionKey: "administration.users.read"
      }
    ])
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
  await page.route("**/rest/v1/department_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "0-0/1", "access-control-expose-headers": "content-range" },
    contentType: "application/json",
    body: JSON.stringify([{
      id: "9007199254740994",
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
    headers: { "content-range": "0-0/1", "access-control-expose-headers": "content-range" },
    contentType: "application/json",
    body: JSON.stringify([{
      id: "9007199254740996",
      post_code: "LEAD",
      post_name: "负责人",
      status: 1,
      description: null,
      created_at: "2026-10-02T00:00:00.000Z",
      updated_at: "2026-10-02T00:00:00.000Z"
    }])
  }));

  await page.route("**/functions/v1/user-management", async route => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    let data: unknown;
    if (body.action === "roles") {
      data = roles;
    } else if (body.action === "list") {
      const filtered = body.query.loginName
        ? users.filter(user => user.loginName.includes(body.query.loginName))
        : users;
      data = {
        items: filtered,
        total: filtered.length,
        page: body.query.page,
        pageSize: body.query.pageSize
      };
    } else if (body.action === "create") {
      const input = body.input;
      const user = {
        id: "9007199254740995",
        userCode: input.userCode,
        loginName: input.loginName,
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
        departmentId: input.departmentId,
        postId: input.postId,
        isActive: true,
        roles: roles.filter(role => input.roleIds.includes(role.id) && role.code !== "SUPER_ADMIN").map(role => ({ ...role, isActive: true })),
        createdAt: "2026-10-02T00:00:00.000Z",
        updatedAt: "2026-10-02T00:00:00.000Z"
      };
      users = [...users, user];
      data = { user };
    } else if (body.action === "update") {
      users = users.map(user => user.id === body.input.id
        ? {
            ...user,
            userCode: body.input.userCode,
            loginName: body.input.loginName,
            displayName: body.input.displayName,
            phone: body.input.phone,
            departmentId: body.input.departmentId,
            postId: body.input.postId,
            roles: body.input.roleIds
              ? roles.filter(role => body.input.roleIds.includes(role.id) && role.code !== "SUPER_ADMIN").map(role => ({ ...role, isActive: true }))
              : user.roles
          }
        : user);
      data = { user: users.find(user => user.id === body.input.id) };
    } else if (body.action === "status") {
      users = users.map(user => user.id === body.id ? { ...user, isActive: body.isActive } : user);
      data = { user: users.find(user => user.id === body.id) };
    } else if (body.action === "reset-password") {
      data = { message: "密码重置邮件已发送" };
    } else if (body.action === "delete") {
      users = users.filter(user => user.id !== body.id);
      data = { id: body.id, deleted: true };
    } else {
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Invalid action" } }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data })
    });
  });

  page.on("dialog", dialog => dialog.accept());
  await page.goto("/#/system/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await expect(page.getByText("工程部 / —", { exact: true })).toBeVisible();
  await expect(page.getByText("员工一百", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新增用户" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("邮箱")).toBeVisible();
  await expect(dialog.getByLabel("密码")).toHaveCount(0);
  await dialog.getByLabel("工号").fill("E-101");
  await dialog.getByLabel("登录名").fill("employee-101");
  await dialog.getByLabel("姓名").fill("员工一百零一");
  await dialog.getByLabel("邮箱").fill("user101@example.test");
  await dialog.getByLabel("部门").selectOption("9007199254740994");
  await dialog.getByLabel("岗位").selectOption("9007199254740996");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("员工一百零一", { exact: true })).toBeVisible();
  await expect(page.getByText("用户已创建，密码重置邮件已发送")).toBeVisible();

  const createdRow = page.getByRole("row").filter({ hasText: "员工一百零一" });
  await createdRow.getByRole("button", { name: "编辑" }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel("姓名").fill("员工一百零一（更新）");
  await editDialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("员工一百零一（更新）", { exact: true })).toBeVisible();

  const updatedRow = page.getByRole("row").filter({ hasText: "员工一百零一（更新）" });
  await updatedRow.getByRole("button", { name: "停用" }).click();
  await expect(updatedRow.getByText("停用", { exact: true })).toBeVisible();
  await updatedRow.getByRole("button", { name: "重置密码" }).click();
  await expect(page.getByText("密码重置邮件已发送")).toBeVisible();
  await updatedRow.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("员工一百零一（更新）", { exact: true })).toHaveCount(0);
  expect(actions).toContain("reset-password");
  expect(actions).toContain("delete");
});
