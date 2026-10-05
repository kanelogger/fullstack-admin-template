import { describe, expect, it } from "vitest";
import { MenuEntrySchema } from "@template/contracts/menu";
import { buildNavigationRoutes } from "./navigation-routes";

const rows = MenuEntrySchema.array().parse([
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
    routeKey: "administration.roles",
    path: "/system/roles",
    title: "角色管理",
    icon: "UserFilled",
    sortOrder: 1,
    requiredPermissionKey: "administration.roles.read"
  },
  {
    id: "12",
    parentId: null,
    kind: "route",
    routeKey: "communication.messages",
    path: "/operation/messages",
    title: "消息中心",
    icon: "Message",
    sortOrder: 0,
    requiredPermissionKey: "communication.messages.read"
  }
]);

describe("Supabase navigation route adapter", () => {
  it("builds groups and maps leaves only through the local RouteKey registry", () => {
    const routes = buildNavigationRoutes(rows);

    expect(routes.map(route => route.name)).toEqual([
      "communication.messages",
      "menu-group-10"
    ]);
    const group = routes[1];
    expect(group.children?.[0]).toMatchObject({
      name: "administration.roles",
      path: "/system/roles",
      meta: {
        title: "角色管理",
        rank: 1,
        auths: ["administration.roles.read"],
        backstage: true
      }
    });
    expect(group.redirect).toBe("/system/roles");
    expect(typeof group.children?.[0].component).toBe("function");
  });

  it("omits an empty group left after permission filtering", () => {
    const routes = buildNavigationRoutes(rows.slice(0, 1));
    expect(routes).toEqual([]);
  });

  it("rejects orphaned children instead of exposing a broken route tree", () => {
    expect(() => buildNavigationRoutes(rows.slice(1, 2))).toThrow(/missing or non-group parent/);
  });
});
