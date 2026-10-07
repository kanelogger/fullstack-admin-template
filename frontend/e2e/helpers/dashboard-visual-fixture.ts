import { DashboardOverviewSchema } from "@template/contracts";
import type { Page } from "@playwright/test";
import { installSupabaseSessionMock } from "./supabase-session";

export const dashboardVisualTime = new Date("2026-10-07T02:00:00.000Z");
export const dashboardActorId = "910000000000003";

export const dashboardVisualOverview = DashboardOverviewSchema.parse({
  todoCount: 1,
  unreadMessageCount: 1,
  todoMessages: [{
    id: "9007199254740996",
    title: "待处理消息",
    summary: "Dashboard 视觉验收数据",
    messageType: "NOTICE",
    readStatus: false,
    sentAt: "2026-10-07T01:30:00.000Z"
  }],
  recentOperations: [{
    id: "9007199254740993",
    operatorName: "视觉验收管理员",
    moduleCode: "DASHBOARD",
    operationType: "VIEW",
    requestParams: { source: "visual-fixture" },
    operationResult: 1,
    operatedAt: "2026-10-07T01:35:00.000Z"
  }],
  recentMessages: [{
    id: "9007199254740995",
    title: "最近系统通知",
    summary: "用于确定性截图的最近通知",
    messageType: "ANNOUNCEMENT",
    readStatus: false,
    sentAt: "2026-10-07T01:00:00.000Z"
  }],
  adminStats: {
    userCount: 3,
    roleCount: 2,
    menuCount: 5,
    todayLoginCount: 4,
    apiErrorCount: 1
  }
});

export async function installDashboardVisualFixture(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.clock.install({ time: dashboardVisualTime });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(isDark => document.documentElement.classList.toggle("dark", isDark), theme === "dark");

  const unexpectedRequests: string[] = [];
  const rpcCalls = new Map<string, number>();
  await page.route("**/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").at(-1) ?? "";

    if (url.pathname.includes("/rpc/")) {
      const rpcName = endpoint;
      rpcCalls.set(rpcName, (rpcCalls.get(rpcName) ?? 0) + 1);
      if (rpcName === "current_navigation") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{
          id: "1",
          parentId: null,
          kind: "route",
          routeKey: "dashboard.overview",
          path: "/welcome",
          title: "首页",
          icon: "HomeFilled",
          sortOrder: 0,
          requiredPermissionKey: "dashboard.overview.read"
        }]) });
      }
      if (rpcName === "current_business_user_id") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardActorId) });
      }
      if (rpcName === "dashboard_overview") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardVisualOverview) });
      }
    }

    if (endpoint === "message_read_model") {
      return route.fulfill({
        status: 200,
        headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
        contentType: "application/json",
        body: "[]"
      });
    }

    if (endpoint === "messages" && route.request().method() === "HEAD") {
      return route.fulfill({
        status: 200,
        headers: { "content-range": "*/1", "access-control-expose-headers": "content-range" },
        body: ""
      });
    }

    unexpectedRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.abort("failed");
  });

  await installSupabaseSessionMock(page, {
    userId: dashboardActorId,
    authUserId: "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
    loginName: "visual-admin",
    displayName: "视觉验收管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "dashboard.overview.read",
      "communication.messages.read",
      "administration.users.read",
      "administration.roles.read",
      "administration.menus.read",
      "audit.logs.read"
    ],
    sessionTime: dashboardVisualTime.getTime()
  });

  const debug = page as Page & {
    __dashboardVisualRpcCalls?: Map<string, number>;
    __dashboardVisualUnexpectedRequests?: string[];
  };
  debug.__dashboardVisualRpcCalls = rpcCalls;
  debug.__dashboardVisualUnexpectedRequests = unexpectedRequests;
}

export function dashboardVisualCounts(page: Page): { rpcs: Map<string, number>; unexpected: string[] } {
  const debug = page as Page & {
    __dashboardVisualRpcCalls?: Map<string, number>;
    __dashboardVisualUnexpectedRequests?: string[];
  };
  return {
    rpcs: debug.__dashboardVisualRpcCalls ?? new Map(),
    unexpected: debug.__dashboardVisualUnexpectedRequests ?? []
  };
}
