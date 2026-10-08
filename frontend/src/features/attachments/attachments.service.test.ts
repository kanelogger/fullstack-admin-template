import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    from: vi.fn(),
    rpc: vi.fn(),
    storage: { from: vi.fn() }
  }
}));

vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => mocks.client }));

import { deleteAttachment, downloadAttachment, getAttachments, uploadAttachment } from "./attachments.service";

const actorId = "9007199254740993";
const attachmentId = "9007199254740995";
const now = "2026-10-07T02:00:00.000Z";
const attachmentRow = {
  id: attachmentId,
  original_name: "项目截图.png",
  storage_path: `${actorId}/fixture.png`,
  mime_type: "image/png",
  file_ext: "png",
  file_size: 4,
  business_module: null,
  business_record_id: null,
  reference_status: 0,
  upload_user_id: actorId,
  uploaded_at: now
};

function readQuery(result: unknown) {
  const query = {
    select: vi.fn(() => query),
    ilike: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result)
  };
  return query;
}

describe("attachments service", () => {
  beforeEach(() => {
    mocks.client.from.mockReset();
    mocks.client.rpc.mockReset();
    mocks.client.storage.from.mockReset();
  });

  it("filters attachment rows and preserves PostgreSQL BIGINT IDs as strings", async () => {
    const query = readQuery({ data: [attachmentRow], count: 1, error: null });
    mocks.client.from.mockReturnValue(query);

    const result = await getAttachments({ originalName: "项目_%", businessModule: "PROJECT", page: 2, pageSize: 10 });

    expect(result.items[0]?.id).toBe(attachmentId);
    expect(query.ilike).toHaveBeenCalledWith("original_name", "%项目\\_\\%%");
    expect(query.range).toHaveBeenCalledWith(10, 19);
  });

  it("rejects unsupported file types before storage and removes an uploaded object after metadata failure", async () => {
    const bucket = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
    mocks.client.storage.from.mockReturnValue(bucket);
    mocks.client.rpc
      .mockResolvedValueOnce({ data: actorId, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });

    await expect(uploadAttachment(new File(["x"], "bad.exe", { type: "application/octet-stream" })))
      .rejects.toThrow("文件格式不支持");
    expect(mocks.client.rpc).not.toHaveBeenCalled();

    const file = new File(["png!"], "sample.png", { type: "image/png" });
    await expect(uploadAttachment(file)).rejects.toThrow("元数据保存失败");
    expect(mocks.client.storage.from).toHaveBeenCalledWith("admin-attachments");
    expect(bucket.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${actorId}/.+\\.png$`)), file, expect.objectContaining({
      contentType: "image/png",
      upsert: false
    }));
    expect(bucket.remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${actorId}/.+\\.png$`))]);
  });

  it("downloads and deletes metadata using the same exact string ID", async () => {
    const query = readQuery({ data: attachmentRow, error: null });
    const bucket = {
      download: vi.fn().mockResolvedValue({ data: new Blob(["png!"]), error: null }),
      remove: vi.fn().mockResolvedValue({ error: null })
    };
    mocks.client.from.mockReturnValue(query);
    mocks.client.storage.from.mockReturnValue(bucket);
    mocks.client.rpc
      .mockResolvedValueOnce({ data: attachmentRow.storage_path, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const downloaded = await downloadAttachment(attachmentId);
    await deleteAttachment(attachmentId);

    expect(downloaded.attachment.id).toBe(attachmentId);
    expect(downloaded.blob.size).toBe(4);
    expect(query.eq).toHaveBeenCalledWith("id", attachmentId);
    expect(bucket.download).toHaveBeenCalledWith(attachmentRow.storage_path);
    expect(mocks.client.rpc).toHaveBeenNthCalledWith(1, "attachment_storage_path_for_delete", { p_attachment_id: attachmentId });
    expect(mocks.client.rpc).toHaveBeenNthCalledWith(2, "delete_attachment_metadata", { p_attachment_id: attachmentId });
  });
});
