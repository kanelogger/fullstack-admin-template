import { describe, expect, it } from "vitest";
import { MenuCatalogSchema, ManagedMenuSchema, ManagedRouteKeySchema, SaveMenuRequestSchema } from "@template/contracts/menu-management";
import {
  ManagedRoleSchema,
  ReplaceRoleAuthorizationRequestSchema,
  RoleCatalogSchema
} from "@template/contracts/role-management";

const roleRow = {
  id: "9223372036854775807",
  code: "SUPPORT_AGENT",
  name: "客服专员",
  description: null,
  isSystem: false,
  isActive: true,
  userCount: 2,
  permissionKeys: ["communication.messages.read"],
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z"
};

describe("role and menu management contracts", () => {
  it("preserves role and parent menu BIGINT identifiers as decimal strings", () => {
    expect(ManagedRoleSchema.parse(roleRow).id).toBe("9223372036854775807");
    expect(ManagedRoleSchema.safeParse({ ...roleRow, id: 9007199254740991 }).success).toBe(false);

    const menu = {
      id: "9007199254740993",
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
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z"
    };
    expect(ManagedMenuSchema.parse(menu).id).toBe("9007199254740993");
    expect(ManagedMenuSchema.safeParse({ ...menu, parentId: Number("9007199254740993") }).success).toBe(false);
  });

  it("accepts a server-paginated catalog and rejects duplicate or overlapping authorization keys", () => {
    expect(
      RoleCatalogSchema.parse({
        roles: [roleRow],
        permissions: [{ key: "communication.messages.read", description: "读取消息" }],
        menus: [],
        total: 1,
        page: 1,
        pageSize: 10
      }).roles[0]?.id
    ).toBe(roleRow.id);
    expect(
      ReplaceRoleAuthorizationRequestSchema.safeParse({
        roleId: roleRow.id,
        menuPermissionKeys: ["communication.messages.read", "communication.messages.read"],
        actionPermissionKeys: []
      }).success
    ).toBe(false);
    expect(ReplaceRoleAuthorizationRequestSchema.safeParse({
      roleId: roleRow.id,
      menuPermissionKeys: ["communication.messages.read"],
      actionPermissionKeys: ["communication.messages.read"]
    }).success).toBe(false);
  });

  it("restricts route keys to the closed component registry and rejects component paths", () => {
    expect(ManagedRouteKeySchema.safeParse("administration.roles").success).toBe(true);
    expect(ManagedRouteKeySchema.safeParse("../../views/unsafe.vue").success).toBe(false);
    const validMenu = {
      id: "1",
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
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z"
    };
    expect(ManagedMenuSchema.safeParse({ ...validMenu, componentPath: "../../views/unsafe.vue" }).success).toBe(false);
    expect(MenuCatalogSchema.safeParse([validMenu]).success).toBe(true);
    expect(SaveMenuRequestSchema.safeParse({
      parentId: null,
      kind: "group",
      routeKey: "administration.roles",
      path: "/system",
      title: "系统管理",
      icon: null,
      sortOrder: 0,
      isVisible: true,
      isActive: true,
      requiredPermissionKey: null
    }).success).toBe(false);
  });
});
