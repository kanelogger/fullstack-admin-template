import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({ functions: { invoke: mocks.invoke } })
}));

import { deleteManagedUser, listManagedUsers, updateManagedUser } from "./users.service";

const userId = "9007199254740993";
const now = "2026-10-07T02:00:00.000Z";
const managedUser = {
  id: userId,
  userCode: "EMP-001",
  loginName: "operator.one",
  displayName: "林嘉宁",
  email: "operator.one@example.test",
  phone: "13800138000",
  departmentId: null,
  postId: null,
  isActive: true,
  roles: [{ id: "9007199254740995", code: "OPERATOR", name: "运营人员", isActive: true }],
  createdAt: now,
  updatedAt: now
};

describe("users service", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("parses paginated user records and sends normalized list filters", async () => {
    mocks.invoke.mockResolvedValue({
      data: { success: true, data: { items: [managedUser], total: 1, page: 1, pageSize: 10 } },
      error: null
    });

    const result = await listManagedUsers({ loginName: " operator.one ", page: 1, pageSize: 10 });

    expect(result.items[0]?.id).toBe(userId);
    expect(mocks.invoke).toHaveBeenCalledWith("user-management", {
      body: { action: "list", query: { loginName: "operator.one", page: 1, pageSize: 10 } }
    });
  });

  it("updates the selected user with a text ID and rejects numeric IDs before a request", async () => {
    mocks.invoke.mockResolvedValue({
      data: { success: true, data: { user: managedUser } },
      error: null
    });

    const result = await updateManagedUser({
      id: userId,
      userCode: "EMP-001",
      loginName: "operator.one",
      displayName: "林嘉宁",
      phone: "13800138000",
      departmentId: null,
      postId: null
    });
    expect(result.id).toBe(userId);
    await expect(deleteManagedUser(Number(userId))).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "user-management",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "update",
          input: expect.objectContaining({ id: userId })
        })
      })
    );
  });
});
