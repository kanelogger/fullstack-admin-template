import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({ rpc: supabaseMock.rpc })
}));

import { getDashboardOverview } from "./dashboard.service";

const validOverview = {
  todoCount: 0,
  unreadMessageCount: 0,
  todoMessages: [],
  recentOperations: [],
  recentMessages: [],
  adminStats: null
};

describe("getDashboardOverview", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("calls only the caller-scoped RPC and validates its response", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: validOverview, error: null });

    await expect(getDashboardOverview()).resolves.toEqual(validOverview);
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
    expect(supabaseMock.rpc).toHaveBeenCalledWith("dashboard_overview");
  });

  it("rejects an invalid payload instead of passing it to the page", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { ...validOverview, todoMessages: [{ id: 1 }] },
      error: null
    });

    await expect(getDashboardOverview()).rejects.toThrow();
  });

  it("propagates a failed RPC as a service error", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });

    await expect(getDashboardOverview()).rejects.toThrow("首页数据加载失败或当前账号无读取权限");
  });
});
