import {
  BusinessIdSchema,
  MarkMessagesReadRequestSchema,
  MessageDetailSchema,
  MessageListItemSchema,
  MessageListRequestSchema,
  MessagePageSchema,
  type BusinessId,
  type MessageDetail,
  type MessageListItem,
  type MessageListRequest,
  type MessagePage
} from "@template/contracts";
import { getSupabaseClient } from "@/lib/supabase/client";

type QueryRow = Record<string, unknown>;

function failure(message: string): Error {
  return new Error(message);
}

function startOfUtcDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function startOfNextUtcDay(date: string): string {
  const nextDay = new Date(startOfUtcDay(date));
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.toISOString();
}

function listItemFromRow(value: unknown): MessageListItem {
  if (!value || typeof value !== "object") throw failure("消息数据格式无效");
  const row = value as QueryRow;
  return MessageListItemSchema.parse({
    id: row.id,
    title: row.title,
    messageType: row.message_type,
    summary: row.summary,
    readStatus: row.read_status,
    sentAt: row.sent_at,
    readAt: row.read_at
  });
}

function detailFromRow(value: unknown): MessageDetail {
  if (!value || typeof value !== "object") throw failure("消息数据格式无效");
  const row = value as QueryRow;
  return MessageDetailSchema.parse({
    ...listItemFromRow(row),
    content: row.content,
    senderId: row.sender_id
  });
}

export async function getCurrentMessageReceiverId(): Promise<BusinessId> {
  const { data, error } = await getSupabaseClient().rpc("current_business_user_id");
  if (error) throw failure("无法读取当前消息接收人");
  return BusinessIdSchema.parse(data);
}

export async function getMessages(input: unknown): Promise<MessagePage> {
  const request: MessageListRequest = MessageListRequestSchema.parse(input);
  const receiverId = await getCurrentMessageReceiverId();
  const client = getSupabaseClient();
  let query = client
    .from("message_read_model")
    .select("id, receiver_id, title, summary, message_type, read_status, sent_at, read_at", {
      count: "exact"
    })
    .eq("receiver_id", receiverId);

  if (request.title) {
    const escapedTitle = request.title.replace(/[\\%_]/g, "\\$&");
    query = query.ilike("title", `%${escapedTitle}%`);
  }
  if (request.messageType) query = query.eq("message_type", request.messageType);
  if (request.readStatus) {
    query = query.eq("read_status", request.readStatus === "read");
  }
  if (request.sentStartAt) {
    query = query.gte("sent_at", startOfUtcDay(request.sentStartAt));
  }
  if (request.sentEndAt) {
    query = query.lt("sent_at", startOfNextUtcDay(request.sentEndAt));
  }

  const from = (request.page - 1) * request.pageSize;
  const { data, error, count } = await query
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + request.pageSize - 1);

  if (error) throw failure("消息列表加载失败");
  return MessagePageSchema.parse({
    items: (data ?? []).map(listItemFromRow),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

export async function getMessage(idInput: unknown): Promise<MessageDetail> {
  const id = BusinessIdSchema.parse(idInput);
  const receiverId = await getCurrentMessageReceiverId();
  const { data, error } = await getSupabaseClient()
    .from("message_read_model")
    .select(
      "id, receiver_id, sender_id, title, summary, content, message_type, read_status, sent_at, read_at"
    )
    .eq("id", id)
    .eq("receiver_id", receiverId)
    .maybeSingle();

  if (error || !data) throw failure("消息不存在或已无权访问");
  return detailFromRow(data);
}

export async function markMessageRead(idInput: unknown): Promise<MessageDetail> {
  const id = BusinessIdSchema.parse(idInput);
  const receiverId = await getCurrentMessageReceiverId();
  const { error } = await getSupabaseClient()
    .from("messages")
    .update({ read_status: true, read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("receiver_id", receiverId)
    .eq("read_status", false)
    .eq("deleted", false);

  if (error) throw failure("标记消息已读失败");
  return getMessage(id);
}

export async function markMessagesRead(input: unknown): Promise<{ count: number }> {
  const request = MarkMessagesReadRequestSchema.parse(input);
  const receiverId = await getCurrentMessageReceiverId();
  let query = getSupabaseClient()
    .from("messages")
    .update({ read_status: true, read_at: new Date().toISOString() })
    .eq("receiver_id", receiverId)
    .eq("read_status", false)
    .eq("deleted", false);

  if ("ids" in request) query = query.in("id", request.ids);

  const { data, error } = await query.select("id");
  if (error) throw failure("批量标记消息已读失败");
  return { count: data?.length ?? 0 };
}

export async function getUnreadMessageCount(receiverIdInput?: unknown): Promise<number> {
  const receiverId =
    receiverIdInput === undefined
      ? await getCurrentMessageReceiverId()
      : BusinessIdSchema.parse(receiverIdInput);
  const { count, error } = await getSupabaseClient()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", receiverId)
    .eq("read_status", false)
    .eq("deleted", false);

  if (error) throw failure("未读消息数量加载失败");
  return count ?? 0;
}

export function subscribeToMessageChanges(
  receiverIdInput: unknown,
  onChange: () => void,
  onStatus?: (status: string, detail?: string) => void
): () => void {
  const receiverId = BusinessIdSchema.parse(receiverIdInput);
  const client = getSupabaseClient();
  // Recipient policies filter Postgres Changes. The subscription itself is not
  // treated as an authorization boundary.
  const channel = client
    .channel(`inbox:${receiverId}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      onChange
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages"
      },
      onChange
    )
    .subscribe((status, error) => onStatus?.(status, error?.message));

  return () => {
    void client.removeChannel(channel);
  };
}
