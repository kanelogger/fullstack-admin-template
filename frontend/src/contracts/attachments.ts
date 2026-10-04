import { z } from "zod";
import { BusinessIdSchema } from "./ids";
import { createPaginatedResultSchema, PaginationRequestSchema } from "./pagination";

export const AttachmentReferenceStatusSchema = z.union([
  z.literal(0),
  z.literal(1)
]);

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
  .strict();

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
  .strict();

export const AttachmentPageSchema = createPaginatedResultSchema(AttachmentSchema);

export type Attachment = z.infer<typeof AttachmentSchema>;
export type AttachmentListRequest = z.infer<typeof AttachmentListRequestSchema>;
export type CreateAttachmentMetadataRequest = z.infer<
  typeof CreateAttachmentMetadataRequestSchema
>;
export type AttachmentPage = z.infer<typeof AttachmentPageSchema>;
