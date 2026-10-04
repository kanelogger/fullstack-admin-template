import { describe, expect, it } from "vitest";
import { DashboardOverviewSchema } from "./dashboard";

const operatorOverview = {
  todoCount: 0,
  unreadMessageCount: 2,
  recentOperations: [{
    id: "9007199254740993",
    operatorName: "运营人员",
    moduleCode: "MESSAGE",
    operationType: "UPDATE",
    requestParams: { recordId: "9007199254740994" },
    operationResult: 1,
    operatedAt: "2026-10-02T10:00:00.000Z"
  }],
  announcements: [{
    id: "9007199254740995",
    title: "系统维护通知",
    summary: null,
    messageType: "ANNOUNCEMENT",
    readStatus: false,
    sentAt: "2026-10-02T09:00:00.000Z"
  }],
  adminStats: null
};

describe("dashboard contract", () => {
  it("preserves BIGINT IDs and permits an operator-scoped overview", () => {
    const result = DashboardOverviewSchema.safeParse(operatorOverview);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recentOperations[0].id).toBe("9007199254740993");
      expect(result.data.announcements[0].id).toBe("9007199254740995");
      expect(result.data.adminStats).toBeNull();
    }
  });

  it("accepts system metrics with per-module hidden values", () => {
    expect(DashboardOverviewSchema.safeParse({
      ...operatorOverview,
      adminStats: {
        userCount: 3,
        roleCount: 2,
        menuCount: 5,
        todayLoginCount: null,
        apiErrorCount: null
      }
    }).success).toBe(true);
  });

  it("rejects rounded numeric BIGINT identifiers and unknown fields", () => {
    expect(DashboardOverviewSchema.safeParse({
      ...operatorOverview,
      recentOperations: [{ ...operatorOverview.recentOperations[0], id: 9007199254740992 }]
    }).success).toBe(false);
    expect(DashboardOverviewSchema.safeParse({ ...operatorOverview, accessToken: "never" }).success).toBe(false);
  });
});
