import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { LoginLog } from "@template/contracts";

const mocks = vi.hoisted(() => ({
  getLoginLogs: vi.fn(),
  getLoginLog: vi.fn(),
  getOperationLogs: vi.fn(),
  getOperationLog: vi.fn(),
  getExceptionLogs: vi.fn(),
  getExceptionLog: vi.fn()
}));

vi.mock("./audit-logs.service", () => ({
  getLoginLogs: mocks.getLoginLogs,
  getLoginLog: mocks.getLoginLog,
  getOperationLogs: mocks.getOperationLogs,
  getOperationLog: mocks.getOperationLog,
  getExceptionLogs: mocks.getExceptionLogs,
  getExceptionLog: mocks.getExceptionLog
}));

import AuditLogPage from "./AuditLogPage.vue";

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const timestamp = "2026-10-07T02:00:00.000Z";

function loginRow(id: string, loginName: string, userAgent: string): LoginLog {
  return {
    id,
    userId: "10",
    loginName,
    loginIp: "127.0.0.1",
    userAgent,
    loginResult: 1,
    failureReason: null,
    loggedAt: timestamp
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await nextTick();
};

function detailButtons() {
  return wrapper!.findAll("button").filter((button) => button.text() === "详情");
}

function dialog() {
  return document.querySelector('[role="dialog"]');
}

describe("audit log detail requests", () => {
  it("opens the dialog immediately and ignores a slower earlier response", async () => {
    const earlier = loginRow("1", "alice", "list-alice");
    const later = loginRow("2", "bob", "list-bob");
    const earlierDetail = deferred<LoginLog>();
    const laterDetail = deferred<LoginLog>();
    mocks.getLoginLogs.mockResolvedValue({
      items: [earlier, later],
      total: 2,
      page: 1,
      pageSize: 10
    });
    mocks.getLoginLog.mockImplementation((id: string) =>
      id === "1" ? earlierDetail.promise : laterDetail.promise
    );

    wrapper = mount(AuditLogPage, {
      props: { kind: "login" },
      attachTo: document.body
    });
    await flushPromises();

    await detailButtons()[0]!.trigger("click");
    await settle();

    expect(dialog()?.textContent).toContain("正在加载详细信息…");
    expect(dialog()?.textContent).toContain("alice");

    await detailButtons()[1]!.trigger("click");
    await settle();
    expect(dialog()?.textContent).toContain("bob");
    expect(dialog()?.textContent).not.toContain("alice");

    laterDetail.resolve({ ...later, userAgent: "detail-bob" });
    await settle();
    expect(dialog()?.textContent).toContain("detail-bob");

    earlierDetail.resolve({ ...earlier, userAgent: "detail-alice" });
    await settle();
    expect(dialog()?.textContent).toContain("detail-bob");
    expect(dialog()?.textContent).not.toContain("detail-alice");
    expect(dialog()?.textContent).toContain("查看此条审计记录的完整字段。");
  });

  it("does not reopen the dialog when a closed request resolves", async () => {
    const row = loginRow("1", "alice", "list-alice");
    const detail = deferred<LoginLog>();
    mocks.getLoginLogs.mockResolvedValue({
      items: [row],
      total: 1,
      page: 1,
      pageSize: 10
    });
    mocks.getLoginLog.mockReturnValue(detail.promise);

    wrapper = mount(AuditLogPage, {
      props: { kind: "login" },
      attachTo: document.body
    });
    await flushPromises();

    await detailButtons()[0]!.trigger("click");
    await settle();
    const close = [...dialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "关闭"
    );
    close!.click();
    await settle();
    expect(dialog()).toBeNull();

    detail.resolve({ ...row, userAgent: "detail-alice" });
    await settle();
    expect(dialog()).toBeNull();
    expect(wrapper.text()).not.toContain("日志详情加载失败");
  });
});
