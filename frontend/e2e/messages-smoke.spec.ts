import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const businessUserId = "910000000000001";
const authUserId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";

test("message center loads the recipient inbox and marks a message read", async ({ page }) => {
  const messageRows = [
    {
      id: "920000000000001",
      receiver_id: businessUserId,
      sender_id: null,
      title: "项目通知",
      summary: "测试环境已准备完成",
      content: "请查看测试环境并开始验收。",
      message_type: "NOTICE",
      read_status: false,
      sent_at: "2026-10-01T10:00:00.000Z",
      read_at: null as string | null
    },
    {
      id: "920000000000002",
      receiver_id: businessUserId,
      sender_id: null,
      title: "系统维护提醒",
      summary: "本周将进行例行维护",
      content: "维护期间管理后台可能短暂不可用。",
      message_type: "ANNOUNCEMENT",
      read_status: false,
      sent_at: "2026-10-01T09:00:00.000Z",
      read_at: null as string | null
    }
  ];

  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "common-user",
    displayName: "普通用户",
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

  await page.route("**/rest/v1/rpc/current_business_user_id", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(businessUserId)
    })
  );

  await page.route("**/rest/v1/message_read_model**", route => {
    const idFilter = new URL(route.request().url()).searchParams.get("id");
    const result = messageRows.filter(
      row => !idFilter || idFilter === `eq.${row.id}`
    );
    const countRange = result.length ? `0-${result.length - 1}/${result.length}` : "*/0";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "content-range": countRange,
        "access-control-expose-headers": "content-range"
      },
      body: JSON.stringify(result)
    });
  });

  await page.route("**/rest/v1/messages**", async route => {
    const request = route.request();
    if (request.method() === "HEAD") {
      const unreadCount = messageRows.filter(row => !row.read_status).length;
      return route.fulfill({
        status: 200,
        headers: {
          "content-range": unreadCount ? `0-${unreadCount - 1}/${unreadCount}` : "*/0",
          "access-control-expose-headers": "content-range"
        }
      });
    }
    if (request.method() === "PATCH") {
      const idFilter = new URL(request.url()).searchParams.get("id") ?? "";
      let targetIds: string[];
      if (idFilter.startsWith("eq.")) {
        targetIds = [idFilter.slice(3)];
      } else if (idFilter.startsWith("in.(") && idFilter.endsWith(")")) {
        targetIds = idFilter.slice(4, -1).split(",");
      } else {
        targetIds = messageRows.filter(row => !row.read_status).map(row => row.id);
      }
      for (const row of messageRows) {
        if (targetIds.includes(row.id)) {
          row.read_status = true;
          row.read_at = "2026-10-01T10:05:00.000Z";
        }
      }
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/#/operation/messages");

  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "项目通知" })).toBeVisible();
  await expect(page.getByRole("main").getByText("2 条未读", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "项目通知" }).click();
  await expect(page.getByRole("dialog")).toContainText("请查看测试环境并开始验收。");
  await page.getByRole("button", { name: "关闭消息详情" }).click();

  const firstRow = page.getByRole("row").filter({ hasText: "项目通知" });
  await firstRow.getByRole("button", { name: "标为已读" }).click();
  await expect(page.getByRole("main").getByText("1 条未读", { exact: true })).toBeVisible();

  const secondRow = page.getByRole("row").filter({ hasText: "系统维护提醒" });
  await secondRow.getByRole("checkbox").check();
  await page.getByRole("button", { name: "选中已读" }).click();

  await expect(page.getByRole("main").getByText("0 条未读", { exact: true })).toBeVisible();
  await expect(secondRow.getByText("已读", { exact: true })).toBeVisible();
});
