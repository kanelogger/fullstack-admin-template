// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, type Pinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { DashboardOverview } from "@template/contracts";

const dashboardMocks = vi.hoisted(() => ({ getOverview: vi.fn(), push: vi.fn() }));
let mockTestPinia: Pinia | undefined;

vi.mock("@/features/dashboard/dashboard.service", () => ({
  getDashboardOverview: dashboardMocks.getOverview
}));

vi.mock("@/stores/modules/notification", async () => {
  const { defineStore } = await import("pinia");
  const useNotificationStore = defineStore("notification", {
    state: () => ({ unreadMessageCount: 0, messageRevision: 0, loadError: "" }),
    actions: {
      reset() {
        this.unreadMessageCount = 0;
        this.messageRevision = 0;
        this.loadError = "";
      }
    }
  });
  return {
    useNotificationStore,
    useNotificationStoreHook: () => {
      if (!mockTestPinia) throw new Error("Dashboard component test Pinia is not initialized");
      return useNotificationStore(mockTestPinia);
    }
  };
});

vi.mock("vue-router", async importOriginal => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({ push: dashboardMocks.push })
  };
});

import Dashboard from "./index.vue";
import { useNotificationStore } from "@/stores/modules/notification";

const overview = (messageTitle: string): DashboardOverview => ({
  todoCount: 1,
  unreadMessageCount: 1,
  todoMessages: [{
    id: "9007199254740996",
    title: messageTitle,
    summary: "待办摘要",
    messageType: "NOTICE",
    readStatus: false,
    sentAt: "2026-10-02T09:30:00.000Z"
  }],
  recentOperations: [{
    id: "9007199254740993",
    operatorName: "试点管理员",
    moduleCode: "AGENT_PILOT",
    operationType: "VERIFY",
    requestParams: { accessToken: "must-not-render" },
    operationResult: 1,
    operatedAt: "2026-10-02T10:00:00.000Z"
  }],
  recentMessages: [{
    id: "9007199254740995",
    title: "最近通知",
    summary: "最近通知摘要",
    messageType: "ANNOUNCEMENT",
    readStatus: false,
    sentAt: "2026-10-02T09:00:00.000Z"
  }],
  adminStats: {
    userCount: 3,
    roleCount: 2,
    menuCount: 5,
    todayLoginCount: 4,
    apiErrorCount: 1
  }
});

describe("Dashboard component", () => {
  let pinia: Pinia;
  let notificationStore: ReturnType<typeof useNotificationStore>;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    pinia = createPinia();
    mockTestPinia = pinia;
    notificationStore = useNotificationStore(pinia);
    dashboardMocks.getOverview.mockReset();
    dashboardMocks.push.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    notificationStore.reset();
    disposePinia(pinia);
    mockTestPinia = undefined;
  });

  function mountDashboard(): VueWrapper {
    wrapper = mount(Dashboard, { global: { plugins: [pinia] } });
    return wrapper;
  }

  it("loads once, renders caller-scoped data, and routes a todo with its string ID", async () => {
    dashboardMocks.getOverview.mockResolvedValue(overview("待处理消息"));

    const page = mountDashboard();
    await flushPromises();

    expect(dashboardMocks.getOverview).toHaveBeenCalledOnce();
    expect(page.get("h1").text()).toContain("系统概览");
    expect(page.text()).toContain("最近通知");
    expect(page.text()).toContain("AGENT_PILOT / VERIFY");
    expect(page.text()).not.toContain("must-not-render");

    const todoButton = page.findAll("button").find(button => button.text().includes("待处理消息"));
    if (!todoButton) throw new Error("Dashboard todo button was not rendered");
    await todoButton.trigger("click");
    expect(dashboardMocks.push).toHaveBeenCalledWith({
      path: "/operation/messages",
      query: { messageId: "9007199254740996" }
    });
  });

  it("shows the first-load error and retries the service", async () => {
    dashboardMocks.getOverview
      .mockRejectedValueOnce(new Error("暂时不可用"))
      .mockResolvedValueOnce(overview("恢复后的消息"));

    const page = mountDashboard();
    await flushPromises();

    expect(page.find('[role="alert"]').text()).toContain("首页数据加载失败");
    expect(page.find('[role="alert"]').text()).toContain("暂时不可用");
    await page.find('[role="alert"] button').trigger("click");
    await flushPromises();

    expect(dashboardMocks.getOverview).toHaveBeenCalledTimes(2);
    expect(page.text()).toContain("恢复后的消息");
  });

  it("preserves the last successful overview when a later refresh fails", async () => {
    dashboardMocks.getOverview
      .mockResolvedValueOnce(overview("保留的消息"))
      .mockRejectedValueOnce(new Error("刷新失败"));

    const page = mountDashboard();
    await flushPromises();
    await page.find("header button").trigger("click");
    await flushPromises();

    expect(dashboardMocks.getOverview).toHaveBeenCalledTimes(2);
    expect(page.text()).toContain("保留的消息");
    expect(page.find('[role="status"]').text()).toContain("刷新失败");
  });

  it("reloads after the notification store message revision changes", async () => {
    dashboardMocks.getOverview
      .mockResolvedValueOnce(overview("初次消息"))
      .mockResolvedValueOnce(overview("Realtime 更新后的消息"));

    const page = mountDashboard();
    await flushPromises();
    notificationStore.messageRevision += 1;
    await flushPromises();

    expect(dashboardMocks.getOverview).toHaveBeenCalledTimes(2);
    expect(page.text()).toContain("Realtime 更新后的消息");
  });

  it("stops reacting to notification revisions after unmount", async () => {
    dashboardMocks.getOverview.mockResolvedValue(overview("初次消息"));

    const page = mountDashboard();
    await flushPromises();
    page.unmount();
    wrapper = undefined;
    notificationStore.messageRevision += 1;
    await flushPromises();

    expect(dashboardMocks.getOverview).toHaveBeenCalledOnce();
  });
});
