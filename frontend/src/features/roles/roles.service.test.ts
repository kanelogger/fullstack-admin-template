import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => ({ rpc: mocks.rpc }) }));

import { getRoleCatalog, replaceRoleAuthorization, saveRole } from "./roles.service";

const roleId = "9007199254740993";
const now = "2026-10-07T02:00:00.000Z";
const role = {
  id: roleId,
  code: "OPERATOR",
  name: "运营人员",
  description: "负责日常业务运营",
  isSystem: false,
  isActive: true,
  userCount: 3,
  permissionKeys: ["organization.posts.read"],
  createdAt: now,
  updatedAt: now
};

describe("roles service", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("passes catalog filters and preserves role bigint IDs as strings", async () => {
    mocks.rpc.mockResolvedValue({
      data: { roles: [role], permissions: [], menus: [], total: 1, page: 2, pageSize: 10 },
      error: null
    });

    const result = await getRoleCatalog({
      name: "运营",
      code: "OPERATOR",
      status: "active",
      page: 2,
      pageSize: 10
    });

    expect(result.roles[0]?.id).toBe(roleId);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_roles_page", {
      p_name: "运营",
      p_code: "OPERATOR",
      p_status: "active",
      p_page: 2,
      p_page_size: 10
    });
  });

  it("keeps menu and action permission keys separate when saving role authorization", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await replaceRoleAuthorization({
      roleId,
      menuPermissionKeys: ["organization.posts.read"],
      actionPermissionKeys: ["organization.posts.update"]
    });

    expect(mocks.rpc).toHaveBeenCalledWith("replace_role_authorization", {
      p_role_id: roleId,
      p_menu_permission_keys: ["organization.posts.read"],
      p_action_permission_keys: ["organization.posts.update"]
    });
  });

  it("saves role metadata using the stable role ID", async () => {
    mocks.rpc.mockResolvedValue({ data: role, error: null });

    const result = await saveRole({
      id: roleId,
      code: role.code,
      name: role.name,
      description: role.description,
      isActive: true
    });

    expect(result.id).toBe(roleId);
    expect(mocks.rpc).toHaveBeenCalledWith("save_admin_role", {
      p_role_id: roleId,
      p_code: "OPERATOR",
      p_name: "运营人员",
      p_description: "负责日常业务运营",
      p_is_active: true
    });
  });
});
