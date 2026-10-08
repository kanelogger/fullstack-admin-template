import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => ({ rpc: mocks.rpc }) }));

import { getMenuRoleCatalog, replaceMenuRoleAuthorization } from "./menus.service";

describe("menus service", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("loads menu role authorization with exact IDs and selected state", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        permissionKey: "administration.roles.read",
        sharedMenuCount: 1,
        roles: [{
          id: "9007199254740995",
          code: "SUPPORT_AGENT",
          name: "客服专员",
          isActive: true,
          isSystem: false,
          authorized: true
        }]
      },
      error: null
    });

    const result = await getMenuRoleCatalog("9007199254740994");

    expect(result.roles[0]?.id).toBe("9007199254740995");
    expect(result.roles[0]?.authorized).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("menu_role_catalog", { p_menu_id: "9007199254740994" });
  });

  it("replaces role IDs for the selected menu without numeric coercion", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await replaceMenuRoleAuthorization({
      menuId: "9007199254740994",
      roleIds: ["9007199254740995"]
    });

    expect(mocks.rpc).toHaveBeenCalledWith("replace_menu_role_authorization", {
      p_menu_id: "9007199254740994",
      p_role_ids: ["9007199254740995"]
    });
  });
});
