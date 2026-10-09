import { DashboardOverviewSchema } from "@template/contracts";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseRegisteredMenuRoutes } from "../../../scripts/menu-route-metadata.mjs";
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

const fixtureTimestamp = "2026-10-07T02:00:00.000Z";
const visualUser = {
  id: "9007199254740993",
  userCode: "EMP-001",
  loginName: "visual-operator",
  displayName: "林嘉宁",
  email: "lin.jianing@example.test",
  phone: "13800138000",
  departmentId: null,
  postId: null,
  isActive: true,
  roles: [{ id: "9007199254740994", code: "OPERATOR", name: "运营人员", isActive: true }],
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp
};

const visualRoleCatalog = {
  roles: [{
    id: "9007199254740994",
    code: "OPERATOR",
    name: "运营人员",
    description: "负责日常业务运营",
    isSystem: false,
    isActive: true,
    userCount: 3,
    permissionKeys: ["organization.posts.read", "configuration.dictionaries.read"],
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp
  }],
  permissions: [
    { key: "organization.posts.read", description: "读取岗位" },
    { key: "configuration.dictionaries.read", description: "读取数据字典" },
    { key: "configuration.dictionaries.update", description: "编辑数据字典" }
  ],
  menus: [
    {
      id: "21", parentId: null, kind: "route", routeKey: "administration.posts", path: "/system/posts",
      title: "岗位管理", icon: "Postcard", sortOrder: 4, isVisible: true, isActive: true,
      requiredPermissionKey: "organization.posts.read", createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp
    },
    {
      id: "22", parentId: null, kind: "route", routeKey: "administration.dictionaries", path: "/system/dicts",
      title: "数据字典", icon: "Collection", sortOrder: 5, isVisible: true, isActive: true,
      requiredPermissionKey: "configuration.dictionaries.read", createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp
    }
  ],
  total: 1,
  page: 1,
  pageSize: 10
};

const visualExtraPermissions = [
  "identity.profile.update",
  "communication.messages.update",
  "files.attachments.upload",
  "files.attachments.delete",
  "administration.users.create",
  "administration.users.update",
  "administration.users.delete",
  "administration.users.reset_password",
  "administration.users.assign_roles",
  "administration.roles.create",
  "administration.roles.update",
  "administration.roles.delete",
  "administration.roles.assign_permissions",
  "administration.menus.create",
  "administration.menus.update",
  "administration.menus.delete",
  "organization.departments.create",
  "organization.departments.update",
  "organization.departments.delete",
  "organization.posts.create",
  "organization.posts.update",
  "organization.posts.delete",
  "configuration.dictionaries.create",
  "configuration.dictionaries.update",
  "configuration.dictionaries.delete",
  "configuration.system.update"
];

async function registeredRoutes() {
  const source = await readFile(new URL("../../src/features/menus/menu-routes.registry.ts", import.meta.url), "utf8");
  const seed = await readFile(new URL("../../../supabase/seed.sql", import.meta.url), "utf8");
  const seedMenus = new Map([...seed.matchAll(/\(\s*\d+,\s*(?:null|\d+),\s*'route',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/g)]
    .map(([, routeKey, path, title, icon]) => [routeKey, { path, title, icon }]));
  const routes = parseRegisteredMenuRoutes(source)
    .map(({ routeKey, label, defaultPath: path, requiredPermissionKey }, index) => {
      const seeded = seedMenus.get(routeKey);
      if (!seeded || seeded.path !== path) throw new Error(`Route ${routeKey} is missing matching visual seed metadata`);
      return { id: String(index + 1), routeKey, label, path, title: seeded.title, icon: seeded.icon, requiredPermissionKey };
    });
  if (routes.length === 0) throw new Error("Visual fixtures require registered routes");
  return routes;
}

export async function installDashboardVisualFixture(
  page: Page,
  theme: "light" | "dark"
): Promise<void> {
  await page.clock.setFixedTime(dashboardVisualTime);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(isDark => {
    document.documentElement.classList.toggle("dark", isDark);
  }, theme === "dark");
  const routes = await registeredRoutes();

  const unexpectedRequests: string[] = [];
  const rpcCalls = new Map<string, number>();
  await page.route("**/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").at(-1) ?? "";

    if (url.pathname.includes("/rpc/")) {
      const rpcName = endpoint;
      rpcCalls.set(rpcName, (rpcCalls.get(rpcName) ?? 0) + 1);
      if (rpcName === "current_navigation") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routes.map(route => ({
          id: route.id,
          parentId: null,
          kind: "route",
          routeKey: route.routeKey,
          path: route.path,
          title: route.title,
          icon: route.icon,
          sortOrder: Number(route.id),
          requiredPermissionKey: route.requiredPermissionKey
        }))) });
      }
      if (rpcName === "current_business_user_id") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardActorId) });
      }
      if (rpcName === "dashboard_overview") {
        const overview = DashboardOverviewSchema.parse({
          ...dashboardVisualOverview,
          adminStats: { ...dashboardVisualOverview.adminStats, menuCount: routes.length }
        });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) });
      }
      if (rpcName === "current_profile") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          id: dashboardActorId,
          authUserId: "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
          loginName: "visual-admin",
          displayName: "视觉验收管理员",
          email: "visual-admin@example.test",
          phone: "13800138001",
          avatarUrl: null,
          isActive: true,
          roleCodes: ["SUPER_ADMIN"],
          permissionKeys: [...routes.map(route => route.requiredPermissionKey), ...visualExtraPermissions],
          mustResetPassword: false
        }) });
      }
      if (rpcName === "admin_roles_page") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(visualRoleCatalog) });
      }
      if (rpcName === "admin_system_configurations") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }) });
      }
      if (rpcName === "admin_dictionary_types") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 10 }) });
      }
      if (["admin_dictionary_items", "dictionary_options", "admin_menu_catalog", "admin_menu_permission_catalog"].includes(rpcName)) {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      unexpectedRequests.push(`${route.request().method()} ${url.pathname}`);
      return route.abort("failed");
    }

    const emptyReadModels = new Set([
      "message_read_model",
      "department_read_model",
      "post_read_model",
      "login_log_read_model",
      "operation_log_read_model",
      "exception_log_read_model",
      "attachment_read_model"
    ]);
    if (emptyReadModels.has(endpoint) && ["GET", "HEAD"].includes(route.request().method())) {
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

    if (endpoint === "messages" && route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
        contentType: "application/json",
        body: "[]"
      });
    }

    unexpectedRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.abort("failed");
  });
  await page.route("**/functions/v1/user-management", async route => {
    const action = route.request().postDataJSON()?.action;
    if (action === "list") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: [visualUser], total: 1, page: 1, pageSize: 10 } })
      });
    }
    if (action === "roles") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
    }
    unexpectedRequests.push(`POST /functions/v1/user-management action=${String(action)}`);
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
      "audit.logs.read",
      ...routes.map(route => route.requiredPermissionKey),
      ...visualExtraPermissions
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
