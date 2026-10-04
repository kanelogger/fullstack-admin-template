import { expect, test, type Page } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const authUserId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const businessUserId = "910000000000003";
const timestamp = "2026-10-02T00:00:00.000Z";

async function prepareOrganizationFixture(page: Page) {
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "org-admin",
    displayName: "组织管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "dashboard.overview.read",
      "organization.departments.read",
      "organization.departments.create",
      "organization.departments.update",
      "organization.departments.delete",
      "organization.posts.read",
      "organization.posts.create",
      "organization.posts.update",
      "organization.posts.delete"
    ]
  });

  let departments = [
    {
      id: "9007199254740993",
      dept_code: "OPS",
      dept_name: "运营部",
      status: 1,
      description: "负责业务运营",
      created_at: timestamp,
      updated_at: timestamp,
      deleted: false
    }
  ];
  let posts = [
    {
      id: "9007199254740995",
      post_code: "OPERATOR",
      post_name: "运营人员",
      status: 1,
      description: "运营岗位",
      created_at: timestamp,
      updated_at: timestamp,
      deleted: false
    }
  ];

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: "20",
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
        id: "21",
        parentId: "20",
        kind: "route",
        routeKey: "administration.departments",
        path: "/system/departments",
        title: "部门管理",
        icon: "OfficeBuilding",
        sortOrder: 3,
        requiredPermissionKey: "organization.departments.read"
      },
      {
        id: "22",
        parentId: "20",
        kind: "route",
        routeKey: "administration.posts",
        path: "/system/posts",
        title: "岗位管理",
        icon: "Postcard",
        sortOrder: 4,
        requiredPermissionKey: "organization.posts.read"
      }
    ])
  }));

  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(businessUserId)
  }));

  await page.route("**/rest/v1/messages**", route => {
    if (route.request().method() === "HEAD") {
      return route.fulfill({
        status: 200,
        headers: {
          "content-range": "*/0",
          "access-control-expose-headers": "content-range"
        }
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route("**/rest/v1/department_read_model**", route => {
    const url = new URL(route.request().url());
    const codeFilter = url.searchParams.get("dept_code");
    const nameFilter = url.searchParams.get("dept_name");
    const statusFilter = url.searchParams.get("status");
    const filtered = departments.filter(row =>
      !row.deleted &&
      (!codeFilter || (codeFilter.startsWith("eq.")
        ? row.dept_code === codeFilter.slice(3)
        : row.dept_code.toLowerCase().includes(codeFilter.replace(/^ilike\.%?|%?$/g, "").toLowerCase()))) &&
      (!nameFilter || row.dept_name.toLowerCase().includes(nameFilter.replace(/^ilike\.%?|%?$/g, "").toLowerCase())) &&
      (!statusFilter || row.status === Number(statusFilter.slice(3)))
    );
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const result = filtered.slice(offset, offset + limit);
    const headers = {
      "content-range": result.length ? `${offset}-${offset + result.length - 1}/${filtered.length}` : `*/${filtered.length}`,
      "access-control-expose-headers": "content-range"
    };
    if (route.request().method() === "GET") {
      const codeEq = codeFilter?.startsWith("eq.") ? codeFilter.slice(3) : null;
      const single = codeEq ? filtered.find(row => row.dept_code === codeEq) : null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify(single ? [single] : result)
      });
    }
    return route.fulfill({ status: 405 });
  });

  await page.route("**/rest/v1/post_read_model**", route => {
    const url = new URL(route.request().url());
    const codeFilter = url.searchParams.get("post_code");
    const nameFilter = url.searchParams.get("post_name");
    const statusFilter = url.searchParams.get("status");
    const filtered = posts.filter(row =>
      !row.deleted &&
      (!codeFilter || (codeFilter.startsWith("eq.")
        ? row.post_code === codeFilter.slice(3)
        : row.post_code.toLowerCase().includes(codeFilter.replace(/^ilike\.%?|%?$/g, "").toLowerCase()))) &&
      (!nameFilter || row.post_name.toLowerCase().includes(nameFilter.replace(/^ilike\.%?|%?$/g, "").toLowerCase())) &&
      (!statusFilter || row.status === Number(statusFilter.slice(3)))
    );
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const result = filtered.slice(offset, offset + limit);
    const headers = {
      "content-range": result.length ? `${offset}-${offset + result.length - 1}/${filtered.length}` : `*/${filtered.length}`,
      "access-control-expose-headers": "content-range"
    };
    if (route.request().method() === "GET") {
      const codeEq = codeFilter?.startsWith("eq.") ? codeFilter.slice(3) : null;
      const single = codeEq ? filtered.find(row => row.post_code === codeEq) : null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify(single ? [single] : result)
      });
    }
    return route.fulfill({ status: 405 });
  });

  await page.route("**/rest/v1/departments**", async route => {
    const request = route.request();
    const payload = request.postDataJSON() as Record<string, unknown>;
    if (request.method() === "POST") {
      const row = {
        id: "9007199254740997",
        ...payload,
        created_at: timestamp,
        updated_at: timestamp,
        deleted: false
      } as (typeof departments)[number];
      departments = [...departments, row];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ dept_code: row.dept_code })
      });
    }
    if (request.method() === "PATCH") {
      const id = new URL(request.url()).searchParams.get("id")?.slice(3);
      departments = departments.map(row =>
        row.id === id ? { ...row, ...payload, updated_at: timestamp } : row
      );
      const row = departments.find(item => item.id === id);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "content-range": row ? "0-0/1" : "*/0",
          "access-control-expose-headers": "content-range"
        },
        body: JSON.stringify(row ? [{ dept_code: row.dept_code }] : [])
      });
    }
    return route.fulfill({ status: 405 });
  });

  await page.route("**/rest/v1/posts**", async route => {
    const request = route.request();
    const payload = request.postDataJSON() as Record<string, unknown>;
    if (request.method() === "POST") {
      const row = {
        id: "9007199254740999",
        ...payload,
        created_at: timestamp,
        updated_at: timestamp,
        deleted: false
      } as (typeof posts)[number];
      posts = [...posts, row];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ post_code: row.post_code })
      });
    }
    if (request.method() === "PATCH") {
      const id = new URL(request.url()).searchParams.get("id")?.slice(3);
      posts = posts.map(row =>
        row.id === id ? { ...row, ...payload, updated_at: timestamp } : row
      );
      const row = posts.find(item => item.id === id);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "content-range": row ? "0-0/1" : "*/0",
          "access-control-expose-headers": "content-range"
        },
        body: JSON.stringify(row ? [{ post_code: row.post_code }] : [])
      });
    }
    return route.fulfill({ status: 405 });
  });

  await page.route("**/rest/v1/rpc/delete_department", async route => {
    const { p_department_id: id } = route.request().postDataJSON();
    departments = departments.map(row => row.id === id ? { ...row, deleted: true } : row);
    return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
  });

  await page.route("**/rest/v1/rpc/delete_post", async route => {
    const { p_post_id: id } = route.request().postDataJSON();
    posts = posts.map(row => row.id === id ? { ...row, deleted: true } : row);
    return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
  });
}

test("department and post pages list, create, update, and soft-delete with exact string IDs", async ({ page }) => {
  await prepareOrganizationFixture(page);
  page.on("dialog", dialog => dialog.accept());

  await page.goto("/#/system/departments");
  const deptPage = page.getByTestId("department-management");
  await expect(deptPage.getByRole("heading", { name: "部门管理" })).toBeVisible();
  await expect(deptPage.getByText("运营部", { exact: true })).toBeVisible();

  await deptPage.getByRole("button", { name: "新增部门" }).click();
  const deptDialog = page.getByRole("dialog");
  await deptDialog.getByLabel("部门编码").fill("ENG");
  await deptDialog.getByLabel("部门名称").fill("工程部");
  await deptDialog.getByLabel("说明").fill("产品工程团队");
  await deptDialog.getByRole("button", { name: "保存" }).click();
  await expect(deptPage.getByText("工程部", { exact: true })).toBeVisible();

  const engineeringRow = deptPage.getByRole("row").filter({ hasText: "ENG" });
  await engineeringRow.getByRole("button", { name: "编辑" }).click();
  const deptEditDialog = page.getByRole("dialog");
  await deptEditDialog.getByLabel("部门名称").fill("工程技术部");
  await deptEditDialog.getByRole("button", { name: "保存" }).click();
  await expect(deptPage.getByText("工程技术部", { exact: true })).toBeVisible();

  const updatedEngineeringRow = deptPage.getByRole("row").filter({ hasText: "ENG" });
  await updatedEngineeringRow.getByRole("button", { name: "删除" }).click();
  await expect(deptPage.getByText("工程技术部", { exact: true })).toHaveCount(0);

  await page.goto("/#/system/posts");
  const postPage = page.getByTestId("post-management");
  await expect(postPage.getByRole("heading", { name: "岗位管理" })).toBeVisible();
  await expect(postPage.getByText("运营人员", { exact: true })).toBeVisible();

  await postPage.getByRole("button", { name: "新增岗位" }).click();
  const postDialog = page.getByRole("dialog");
  await postDialog.getByLabel("岗位编码").fill("AUDITOR");
  await postDialog.getByLabel("岗位名称").fill("审核人员");
  await postDialog.getByLabel("说明").fill("审阅申请");
  await postDialog.getByRole("button", { name: "保存" }).click();
  await expect(postPage.getByText("审核人员", { exact: true })).toBeVisible();

  const auditorRow = postPage.getByRole("row").filter({ hasText: "AUDITOR" });
  await auditorRow.getByRole("button", { name: "编辑" }).click();
  const postEditDialog = page.getByRole("dialog");
  await postEditDialog.getByLabel("岗位名称").fill("业务审核人员");
  await postEditDialog.getByRole("button", { name: "保存" }).click();
  await expect(postPage.getByText("业务审核人员", { exact: true })).toBeVisible();

  const updatedAuditorRow = postPage.getByRole("row").filter({ hasText: "AUDITOR" });
  await updatedAuditorRow.getByRole("button", { name: "删除" }).click();
  await expect(postPage.getByText("业务审核人员", { exact: true })).toHaveCount(0);
});
