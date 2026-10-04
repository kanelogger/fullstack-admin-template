import {
  AttachmentListRequestSchema,
  AttachmentPageSchema,
  AttachmentSchema,
  BusinessIdSchema,
  CreateAttachmentMetadataRequestSchema,
  type Attachment,
  type AttachmentPage
} from "@/contracts";
import { getSupabaseClient } from "@/shared/supabase/client";

const BUCKET = "admin-attachments";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
type Row = Record<string, unknown>;

function failure(message: string): Error {
  return new Error(message);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function mapAttachment(value: unknown): Attachment {
  if (!value || typeof value !== "object") {
    throw failure("附件数据格式无效");
  }
  const row = value as Row;
  return AttachmentSchema.parse({
    id: row.id,
    originalName: row.original_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileExt: row.file_ext,
    fileSize: Number(row.file_size),
    businessModule: row.business_module,
    businessRecordId: row.business_record_id,
    referenceStatus: Number(row.reference_status),
    uploadUserId: row.upload_user_id,
    uploadedAt: row.uploaded_at
  });
}

export async function getAttachments(input: unknown = {}): Promise<AttachmentPage> {
  const request = AttachmentListRequestSchema.parse(input);
  const client = getSupabaseClient();
  let query = client
    .from("attachment_read_model")
    .select(
      "id, original_name, storage_path, mime_type, file_ext, file_size, business_module, business_record_id, reference_status, upload_user_id, uploaded_at",
      { count: "exact" }
    );

  if (request.originalName) {
    query = query.ilike("original_name", `%${escapeLike(request.originalName)}%`);
  }
  if (request.businessModule) {
    query = query.eq("business_module", request.businessModule);
  }
  if (request.referenceStatus !== undefined) {
    query = query.eq("reference_status", request.referenceStatus);
  }

  const from = (request.page - 1) * request.pageSize;
  const { data, count, error } = await query
    .order("uploaded_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + request.pageSize - 1);
  if (error) throw failure("附件列表加载失败或当前账号无读取权限");

  return AttachmentPageSchema.parse({
    items: (data ?? []).map(mapAttachment),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

async function currentBusinessUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("current_business_user_id");
  if (error) throw failure("无法确认当前账号");
  return BusinessIdSchema.parse(data);
}

function safeExtension(filename: string): string {
  const extension = filename.split(/[\\/]/).at(-1)?.match(/\.([a-z0-9]{1,32})$/i)?.[1];
  return extension?.toLowerCase() ?? "bin";
}

export async function uploadAttachment(
  file: File,
  input: {
    businessModule?: string | null;
    businessRecordId?: string | null;
  } = {}
): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) throw failure("附件不能超过 20 MiB");
  if (file.size < 0) throw failure("附件大小无效");

  const request = CreateAttachmentMetadataRequestSchema.parse({
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileExt: safeExtension(file.name),
    fileSize: file.size,
    businessModule: input.businessModule ?? null,
    businessRecordId: input.businessRecordId ?? null
  });
  const client = getSupabaseClient();
  const actorId = await currentBusinessUserId();
  const storagePath = `${actorId}/${crypto.randomUUID()}.${request.fileExt}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: request.mimeType,
    upsert: false
  });
  if (uploadError) {
    throw failure("附件上传失败；请检查上传权限和文件大小");
  }

  const { data, error } = await client.rpc("create_attachment_metadata", {
    p_original_name: request.originalName,
    p_storage_path: storagePath,
    p_mime_type: request.mimeType,
    p_file_ext: request.fileExt,
    p_file_size: request.fileSize,
    p_business_module: request.businessModule,
    p_business_record_id: request.businessRecordId
  });
  if (error) {
    await client.storage.from(BUCKET).remove([storagePath]);
    throw failure("附件已上传，但元数据保存失败；请确认上传权限后重试");
  }
  return mapAttachment(data);
}

async function getAttachment(idInput: unknown): Promise<Attachment> {
  const id = BusinessIdSchema.parse(idInput);
  const { data, error } = await getSupabaseClient()
    .from("attachment_read_model")
    .select(
      "id, original_name, storage_path, mime_type, file_ext, file_size, business_module, business_record_id, reference_status, upload_user_id, uploaded_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw failure("附件不存在或当前账号无读取权限");
  return mapAttachment(data);
}

export async function downloadAttachment(idInput: unknown): Promise<{
  attachment: Attachment;
  blob: Blob;
}> {
  const attachment = await getAttachment(idInput);
  const { data, error } = await getSupabaseClient()
    .storage.from(BUCKET)
    .download(attachment.storagePath);
  if (error || !data) throw failure("附件下载失败或当前账号无读取权限");
  return { attachment, blob: data };
}

export async function deleteAttachment(idInput: unknown): Promise<void> {
  const id = BusinessIdSchema.parse(idInput);
  const client = getSupabaseClient();
  const { data: path, error: pathError } = await client.rpc(
    "attachment_storage_path_for_delete",
    { p_attachment_id: id }
  );
  if (pathError || typeof path !== "string") {
    throw failure("附件不存在或当前账号无删除权限");
  }

  const { error: storageError } = await client.storage.from(BUCKET).remove([path]);
  if (storageError) throw failure("附件文件删除失败；元数据仍保留");

  const { data, error } = await client.rpc("delete_attachment_metadata", {
    p_attachment_id: id
  });
  if (error || data !== true) {
    throw failure("文件已删除，但附件记录未能更新；请重试删除以完成清理");
  }
}
