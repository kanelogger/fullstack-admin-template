import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: { from: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => mocks.client }));

import { getExceptionLogs, getLoginLogs, getOperationLogs } from "./audit-logs.service";

const bigId = "9007199254740993";
const actorId = "9007199254740995";
const timestamp = "2026-10-07T02:00:00.000Z";

function queryFor(result: { data: unknown[]; count: number; error: null }) {
  const query = {
    select: vi.fn(() => query),
    ilike: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn().mockResolvedValue(result)
  };
  return query;
}

describe("audit log service", () => {
  beforeEach(() => mocks.client.from.mockReset());

  it("lists login outcomes with UTC date bounds and exact string IDs", async () => {
    const query = queryFor({ data: [{
      id: bigId,
      user_id: actorId,
      login_name: "admin",
      login_ip: "127.0.0.1",
      user_agent: "BrowserSkill fixture",
      login_result: 1,
      failure_reason: null,
      logged_at: timestamp
    }], count: 1, error: null });
    mocks.client.from.mockReturnValue(query);

    const result = await getLoginLogs({ loginName: "ad_%min", startAt: "2026-10-07", endAt: "2026-10-07", page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({ id: bigId, userId: actorId, loginName: "admin", loginResult: 1 });
    expect(query.ilike).toHaveBeenCalledWith("login_name", "%ad\\_\\%min%");
    expect(query.gte).toHaveBeenCalledWith("logged_at", "2026-10-07T00:00:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("logged_at", "2026-10-08T00:00:00.000Z");
  });

  it("maps operation request metadata without converting bigint identifiers to numbers", async () => {
    const query = queryFor({ data: [{
      id: bigId,
      operator_id: actorId,
      operator_name: "超级管理员",
      module_code: "USER",
      operation_type: "UPDATE",
      request_method: "PATCH",
      request_path: "/rest/v1/profiles",
      request_params: { recordId: actorId },
      operation_result: 1,
      error_message: null,
      operated_at: timestamp
    }], count: 1, error: null });
    mocks.client.from.mockReturnValue(query);

    const result = await getOperationLogs({ moduleCode: "USER", page: 1, pageSize: 10 });

    expect(result.items[0]).toMatchObject({ id: bigId, operatorId: actorId, requestParams: { recordId: actorId } });
    expect(query.eq).toHaveBeenCalledWith("module_code", "USER");
    expect(query.order).toHaveBeenNthCalledWith(1, "operated_at", { ascending: false });
  });

  it("maps sanitized exception records and filtering fields", async () => {
    const query = queryFor({ data: [{
      id: bigId,
      request_path: "/functions/v1/user-management",
      request_method: "POST",
      error_type: "DatabaseUnavailable",
      error_message: "User management request failed",
      stack_summary: "sanitized stack summary",
      handled_status: 0,
      occurred_at: timestamp
    }], count: 1, error: null });
    mocks.client.from.mockReturnValue(query);

    const result = await getExceptionLogs({ requestPath: "user-management", handledStatus: 0, page: 1, pageSize: 10 });

    expect(result.items[0]).toMatchObject({ id: bigId, errorType: "DatabaseUnavailable", stackSummary: "sanitized stack summary" });
    expect(query.ilike).toHaveBeenCalledWith("request_path", "%user-management%");
    expect(query.eq).toHaveBeenCalledWith("handled_status", 0);
  });
});
