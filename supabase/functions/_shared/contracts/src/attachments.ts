import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { createPaginatedResultSchema, PaginationRequestSchema } from "./pagination.ts";

export const AttachmentReferenceStatusSchema = z.union([
  z.literal(0),
  z.literal(1)
]);

export const ATTACHMENT_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip"
} as const;

export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_MIME_BY_EXTENSION)
  .map(extension => `.${extension}`)
  .join(",");

export function getSupportedAttachmentMimeType(fileExt: string, mimeType?: string): string | null {
  const expectedMimeType = ATTACHMENT_MIME_BY_EXTENSION[
    fileExt.toLowerCase() as keyof typeof ATTACHMENT_MIME_BY_EXTENSION
  ];
  if (!expectedMimeType) return null;
  if (!mimeType) return expectedMimeType;
  return mimeType.trim().toLowerCase() === expectedMimeType ? expectedMimeType : null;
}

export const AttachmentSchema = z
  .object({
    id: BusinessIdSchema,
    originalName: z.string().min(1).max(255).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
    storagePath: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(128),
    fileExt: z.string().min(1).max(32),
    fileSize: z.number().int().min(0).max(20 * 1024 * 1024),
    businessModule: z.string().max(64).nullable(),
    businessRecordId: BusinessIdSchema.nullable(),
    referenceStatus: AttachmentReferenceStatusSchema,
    uploadUserId: BusinessIdSchema,
    uploadedAt: z.string().datetime({ offset: true })
  })
  .strict()
  .superRefine((attachment, context) => {
    if ((attachment.businessModule === null) !== (attachment.businessRecordId === null)) {
      context.addIssue({ code: "custom", path: ["businessRecordId"], message: "Business module and record ID must be provided together" });
    }
    const expectedStatus = attachment.businessModule === null ? 0 : 1;
    if (attachment.referenceStatus !== expectedStatus) {
      context.addIssue({ code: "custom", path: ["referenceStatus"], message: "Reference status must match the business link" });
    }
    if (getSupportedAttachmentMimeType(attachment.fileExt, attachment.mimeType) === null) {
      context.addIssue({ code: "custom", path: ["mimeType"], message: "File extension and MIME type do not match" });
    }
  });

export const AttachmentListRequestSchema = z
  .object({
    originalName: z.string().trim().max(255).optional(),
    businessModule: z.string().trim().max(64).optional(),
    referenceStatus: AttachmentReferenceStatusSchema.optional(),
    ...PaginationRequestSchema.shape
  })
  .strict();

export const CreateAttachmentMetadataRequestSchema = z
  .object({
    originalName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
    mimeType: z.string().trim().min(1).max(128),
    fileExt: z.string().regex(/^[a-z0-9]{1,32}$/),
    fileSize: z.number().int().min(0).max(20 * 1024 * 1024),
    businessModule: z.string().trim().min(1).max(64).nullable(),
    businessRecordId: BusinessIdSchema.nullable()
  })
  .strict()
  .superRefine((attachment, context) => {
    if ((attachment.businessModule === null) !== (attachment.businessRecordId === null)) {
      context.addIssue({ code: "custom", path: ["businessRecordId"], message: "Business module and record ID must be provided together" });
    }
    if (getSupportedAttachmentMimeType(attachment.fileExt, attachment.mimeType) === null) {
      context.addIssue({ code: "custom", path: ["mimeType"], message: "File extension and MIME type do not match" });
    }
  });

export const AttachmentPageSchema = createPaginatedResultSchema(AttachmentSchema);

export type Attachment = z.infer<typeof AttachmentSchema>;
export type AttachmentListRequest = z.infer<typeof AttachmentListRequestSchema>;
export type CreateAttachmentMetadataRequest = z.infer<
  typeof CreateAttachmentMetadataRequestSchema
>;
export type AttachmentPage = z.infer<typeof AttachmentPageSchema>;
