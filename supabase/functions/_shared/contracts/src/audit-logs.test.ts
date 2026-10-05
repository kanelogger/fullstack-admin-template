import { describe, expect, it } from "vitest";
import {
  LoginLogSchema,
  LoginLogListRequestSchema,
  OperationLogSchema,
  ExceptionLogSchema
} from "./audit-logs.ts";

describe("audit log contracts", () => {
  it("keeps login BIGINT IDs as decimal text", () => {
    const result = LoginLogSchema.safeParse({
      id: "9007199254740993",
      userId: "9007199254740994",
      loginName: "admin",
      loginIp: "127.0.0.1",
      userAgent: null,
      loginResult: 1,
      failureReason: null,
      loggedAt: "2026-10-02T10:00:00.000Z"
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe("9007199254740993");
  });

  it("accepts JSONB audit parameters and nullable operator IDs", () => {
    expect(OperationLogSchema.safeParse({
      id: "1",
      operatorId: null,
      operatorName: "历史操作人",
      moduleCode: "USER",
      operationType: "UPDATE",
      requestMethod: "PATCH",
      requestPath: "/profiles",
      requestParams: { recordId: "9007199254740993" },
      operationResult: 1,
      errorMessage: null,
      operatedAt: "2026-10-02T10:00:00.000Z"
    }).success).toBe(true);
  });

  it("preserves multiline exception stack summaries", () => {
    expect(ExceptionLogSchema.safeParse({
      id: "3",
      requestPath: "/functions/v1/user-management",
      requestMethod: "POST",
      errorType: "DatabaseUnavailable",
      errorMessage: "Request failed",
      stackSummary: "Error: unavailable\n  at handler.ts:12",
      handledStatus: 0,
      occurredAt: "2026-10-02T10:00:00.000Z"
    }).success).toBe(true);
  });

  it("rejects reversed or invalid date ranges", () => {
    expect(LoginLogListRequestSchema.safeParse({ startAt: "2026-10-03", endAt: "2026-10-02" }).success).toBe(false);
    expect(LoginLogListRequestSchema.safeParse({ startAt: "2026-02-30" }).success).toBe(false);
  });
});
