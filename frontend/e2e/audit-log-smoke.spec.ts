import { expect, test, type Page } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000003";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const now = "2026-10-02T10:00:00.000Z";

async function prepareAuditPage(page: Page) {
  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "admin",
    displayName: "超级管理员",
    roles: ["SUPER_ADMIN"],
    permissions: ["audit.logs.read"]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: "30",
        parentId: null,
        kind: "group",
        routeKey: null,
        path: "/log",
        title: "日志管理",
        icon: "Document",
        sortOrder: 1,
        requiredPermissionKey: null
      },
      {
        id: "31",
        parentId: "30",
        kind: "route",
        routeKey: "audit.login-logs",
        path: "/log/login-logs",
        title: "登录日志",
        icon: "Key",
        sortOrder: 1,
        requiredPermissionKey: "audit.logs.read"
      },
      {
        id: "32",
        parentId: "30",
        kind: "route",
        routeKey: "audit.operation-logs",
        path: "/log/operation-logs",
        title: "操作日志",
        icon: "Pointer",
        sortOrder: 2,
        requiredPermissionKey: "audit.logs.read"
      },
      {
        id: "33",
        parentId: "30",
        kind: "route",
        routeKey: "audit.exception-logs",
        path: "/log/exception-logs",
        title: "异常日志",
        icon: "WarningFilled",
        sortOrder: 3,
        requiredPermissionKey: "audit.logs.read"
      }
    ])
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(actorId)
  }));
}

async function fulfillLogModel(page: Page, model: string, row: Record<string, unknown>) {
  await page.route(`**/rest/v1/${model}**`, async route => {
    const url = new URL(route.request().url());
    const idFilter = url.searchParams.get("id");
    const rows = idFilter === `eq.${row.id}` || idFilter === null ? [row] : [];
    return route.fulfill({
      status: 200,
      headers: {
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
        "access-control-expose-headers": "content-range"
      },
      contentType: "application/json",
      body: JSON.stringify(rows)
    });
  });
}

test("login logs show account/password outcomes and detail", async ({ page }) => {
  await prepareAuditPage(page);
  await fulfillLogModel(page, "login_log_read_model", {
    id: "9007199254740993",
    user_id: actorId,
    login_name: "admin",
    login_ip: "127.0.0.1",
    user_agent: "Playwright account/password fixture",
    login_result: 1,
    failure_reason: null,
    logged_at: now
  });

  await page.goto("/#/log/login-logs");
  await expect(page.getByRole("heading", { name: "登录日志" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "admin" });
  await expect(row).toContainText("admin");
  await expect(row).toContainText("成功");
  await page.getByRole("button", { name: "详情" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("127.0.0.1");
  await expect(dialog).toContainText("Playwright account/password fixture");
});

test("operation logs display redacted audit metadata and detail", async ({ page }) => {
  await prepareAuditPage(page);
  await fulfillLogModel(page, "operation_log_read_model", {
    id: "9007199254740994",
    operator_id: actorId,
    operator_name: "超级管理员",
    module_code: "USER",
    operation_type: "UPDATE",
    request_method: "PATCH",
    request_path: "/rest/v1/profiles",
    request_params: { recordId: actorId },
    operation_result: 1,
    error_message: null,
    operated_at: now
  });

  await page.goto("/#/log/operation-logs");
  await expect(page.getByRole("heading", { name: "操作日志" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "USER" });
  await expect(row).toContainText("UPDATE");
  await expect(row).toContainText("/rest/v1/profiles");
  await page.getByRole("button", { name: "详情" }).click();
  await expect(page.getByRole("dialog")).toContainText(actorId);
});

test("exception logs expose sanitized error and stack detail", async ({ page }) => {
  await prepareAuditPage(page);
  await fulfillLogModel(page, "exception_log_read_model", {
    id: "9007199254740995",
    request_path: "/functions/v1/user-management",
    request_method: "POST",
    error_type: "DatabaseUnavailable",
    error_message: "User management request failed",
    stack_summary: "sanitized stack summary",
    handled_status: 0,
    occurred_at: now
  });

  await page.goto("/#/log/exception-logs");
  await expect(page.getByRole("heading", { name: "异常日志" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "DatabaseUnavailable" });
  await expect(row).toContainText("未处理");
  await page.getByRole("button", { name: "详情" }).click();
  await expect(page.getByRole("dialog")).toContainText("sanitized stack summary");
});
