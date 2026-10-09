import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const messageMocks = vi.hoisted(() => ({
  currentReceiverId: vi.fn(),
  unreadCount: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}));

vi.mock("@/features/messages/messages.service", () => ({
  getCurrentMessageReceiverId: messageMocks.currentReceiverId,
  getUnreadMessageCount: messageMocks.unreadCount,
  subscribeToMessageChanges: messageMocks.subscribe
}));
vi.mock("../utils", () => ({ store: {} }));

import { useNotificationStore } from "./notification";

const aliceId = "9007199254740994";
const bobId = "9007199254740995";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("notification session ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not restore an unread count after logout clears the store", async () => {
    const pendingCount = deferred<number>();
    messageMocks.currentReceiverId.mockResolvedValue(aliceId);
    messageMocks.unreadCount.mockReturnValue(pendingCount.promise);
    const notifications = useNotificationStore(createPinia());

    const starting = notifications.startMessageUpdates(aliceId);
    await vi.waitFor(() => expect(messageMocks.unreadCount).toHaveBeenCalledOnce());
    notifications.reset();
    pendingCount.resolve(7);
    await starting;

    expect(notifications.unreadMessageCount).toBe(0);
    expect(notifications.loadError).toBe("");
  });

  it("ignores a delayed previous-account count after the recipient changes", async () => {
    const aliceCount = deferred<number>();
    messageMocks.currentReceiverId.mockResolvedValueOnce(aliceId).mockResolvedValueOnce(bobId);
    messageMocks.unreadCount.mockReturnValueOnce(aliceCount.promise).mockResolvedValueOnce(3);
    const notifications = useNotificationStore(createPinia());

    const aliceStart = notifications.startMessageUpdates(aliceId);
    await vi.waitFor(() => expect(messageMocks.unreadCount).toHaveBeenCalledOnce());
    await notifications.startMessageUpdates(bobId);
    expect(notifications.unreadMessageCount).toBe(3);

    aliceCount.resolve(12);
    await aliceStart;
    expect(notifications.unreadMessageCount).toBe(3);
  });

  it("keeps a failed unread count visible until an explicit retry succeeds", async () => {
    messageMocks.currentReceiverId.mockResolvedValue(aliceId);
    messageMocks.unreadCount
      .mockRejectedValueOnce(new Error("暂时不可用"))
      .mockResolvedValueOnce(4);
    const notifications = useNotificationStore(createPinia());

    await notifications.startMessageUpdates(aliceId);
    expect(notifications.loadError).toBe("暂时不可用");

    await notifications.refreshUnreadMessageCount(aliceId);
    expect(notifications.unreadMessageCount).toBe(4);
    expect(notifications.loadError).toBe("");
  });
});
