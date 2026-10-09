import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn()
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel
  })
}));

import { getMessages, markMessagesRead, subscribeToMessageChanges } from "./messages.service";

const receiverId = "9007199254740993";
const messageId = "9007199254740995";
const now = "2026-10-07T02:00:00.000Z";

describe("messages service", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.channel.mockReset();
    mocks.removeChannel.mockReset();
  });

  it("scopes inbox filtering to the current receiver and keeps message IDs as strings", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      ilike: vi.fn(() => query),
      gte: vi.fn(() => query),
      lt: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            id: messageId,
            receiver_id: receiverId,
            title: "项目通知",
            summary: "请完成验收",
            message_type: "NOTICE",
            read_status: false,
            sent_at: now,
            read_at: null
          }
        ],
        count: 1,
        error: null
      })
    };
    mocks.rpc.mockResolvedValue({ data: receiverId, error: null });
    mocks.from.mockReturnValue(query);

    const result = await getMessages({
      title: "项目_%",
      messageType: "NOTICE",
      readStatus: "unread",
      sentEndAt: "2026-10-07",
      page: 2,
      pageSize: 10
    });

    expect(result.items[0]?.id).toBe(messageId);
    expect(query.eq).toHaveBeenCalledWith("receiver_id", receiverId);
    expect(query.ilike).toHaveBeenCalledWith("title", "%项目\\_\\%%");
    expect(query.lt).toHaveBeenCalledWith("sent_at", "2026-10-08T00:00:00.000Z");
    expect(query.range).toHaveBeenCalledWith(10, 19);
  });

  it("marks selected inbox messages read for the current receiver", async () => {
    const query = {
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      select: vi.fn().mockResolvedValue({ data: [{ id: messageId }], error: null })
    };
    mocks.rpc.mockResolvedValue({ data: receiverId, error: null });
    mocks.from.mockReturnValue(query);

    const result = await markMessagesRead({ ids: [messageId] });

    expect(result).toEqual({ count: 1 });
    expect(mocks.from).toHaveBeenCalledWith("messages");
    expect(query.eq).toHaveBeenCalledWith("receiver_id", receiverId);
    expect(query.in).toHaveBeenCalledWith("id", [messageId]);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ read_status: true }));
  });

  it("subscribes to recipient message changes and removes the channel on cleanup", () => {
    const channel = { on: vi.fn(), subscribe: vi.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mocks.channel.mockReturnValue(channel);
    const handler = vi.fn();

    const unsubscribe = subscribeToMessageChanges(receiverId, handler);
    unsubscribe();

    expect(mocks.channel).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^inbox:${receiverId}:`))
    );
    expect(channel.on).toHaveBeenCalledTimes(2);
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
  });
});
