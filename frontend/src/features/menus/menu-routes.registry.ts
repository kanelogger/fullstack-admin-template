import type { Component } from "vue";
import type { ManagedRouteKey } from "@/contracts/menu-management";
import type { PermissionKey } from "@/contracts/permissions";

/**
 * Closed client-side registry. Menu records select one of these stable keys;
 * the database never supplies a Vue path, import expression, or component name.
 */
export const menuRouteRegistry = {
  "dashboard.overview": () => import("@/views/welcome/index.vue"),
  "account.profile": () => import("@/views/profile/index.vue"),
  "account.change-password": () => import("@/views/profile/change-password/index.vue"),
  "communication.messages": () => import("@/views/operation/message/index.vue"),
  "operation.attachments": () => import("@/views/operation/attachment/index.vue"),
  "administration.users": () => import("@/views/system/user/index.vue"),
  "administration.roles": () => import("@/views/system/role/index.vue"),
  "administration.menus": () => import("@/views/system/menu/index.vue"),
  "administration.departments": () => import("@/views/system/dept/index.vue"),
  "administration.posts": () => import("@/views/system/post/index.vue"),
  "administration.dictionaries": () => import("@/views/system/dict/index.vue"),
  "administration.configurations": () => import("@/views/system/config/index.vue"),
  "audit.login-logs": () => import("@/views/log/login-log/index.vue"),
  "audit.operation-logs": () => import("@/views/log/operation-log/index.vue"),
  "audit.exception-logs": () => import("@/views/log/exception-log/index.vue")
} satisfies Record<ManagedRouteKey, () => Promise<{ default: Component }>>;

export type RegisteredMenuRouteKey = ManagedRouteKey;

export const registeredMenuRoutes: ReadonlyArray<{
  routeKey: RegisteredMenuRouteKey;
  label: string;
  defaultPath: string;
  requiredPermissionKey: PermissionKey;
}> = [
  { routeKey: "dashboard.overview", label: "首页", defaultPath: "/welcome", requiredPermissionKey: "dashboard.overview.read" },
  { routeKey: "account.profile", label: "个人信息", defaultPath: "/profile/info", requiredPermissionKey: "identity.profile.read" },
  { routeKey: "account.change-password", label: "修改密码", defaultPath: "/profile/change-password", requiredPermissionKey: "identity.profile.read" },
  { routeKey: "communication.messages", label: "消息中心", defaultPath: "/operation/messages", requiredPermissionKey: "communication.messages.read" },
  { routeKey: "operation.attachments", label: "附件管理", defaultPath: "/operation/attachments", requiredPermissionKey: "files.attachments.read" },
  { routeKey: "administration.users", label: "用户管理", defaultPath: "/system/users", requiredPermissionKey: "administration.users.read" },
  { routeKey: "administration.roles", label: "角色管理", defaultPath: "/system/roles", requiredPermissionKey: "administration.roles.read" },
  { routeKey: "administration.menus", label: "菜单管理", defaultPath: "/system/menus", requiredPermissionKey: "administration.menus.read" },
  { routeKey: "administration.departments", label: "部门管理", defaultPath: "/system/departments", requiredPermissionKey: "organization.departments.read" },
  { routeKey: "administration.posts", label: "岗位管理", defaultPath: "/system/posts", requiredPermissionKey: "organization.posts.read" },
  { routeKey: "administration.dictionaries", label: "字典管理", defaultPath: "/system/dicts", requiredPermissionKey: "configuration.dictionaries.read" },
  { routeKey: "administration.configurations", label: "系统配置", defaultPath: "/system/configs", requiredPermissionKey: "configuration.system.read" },
  { routeKey: "audit.login-logs", label: "登录日志", defaultPath: "/log/login-logs", requiredPermissionKey: "audit.logs.read" },
  { routeKey: "audit.operation-logs", label: "操作日志", defaultPath: "/log/operation-logs", requiredPermissionKey: "audit.logs.read" },
  { routeKey: "audit.exception-logs", label: "异常日志", defaultPath: "/log/exception-logs", requiredPermissionKey: "audit.logs.read" }
];

export function findRegisteredMenuRouteByPath(path: string) {
  return registeredMenuRoutes.find(route => route.defaultPath === path);
}


export function resolveMenuRouteComponent(
  routeKey: ManagedRouteKey
): (() => Promise<{ default: Component }>) | undefined {
  if (!Object.prototype.hasOwnProperty.call(menuRouteRegistry, routeKey)) {
    return undefined;
  }
  return menuRouteRegistry[routeKey as RegisteredMenuRouteKey];
}
