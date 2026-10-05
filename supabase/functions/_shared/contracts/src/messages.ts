import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { createPaginatedResultSchema } from "./pagination.ts";

export const MessageTypeSchema = z.string().trim().min(1).max(32);

const MessageDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Expected a valid YYYY-MM-DD date");

export const MessageListRequestSchema = z
  .object({
    title: z.string().trim().max(128).optional(),
    messageType: MessageTypeSchema.optional(),
    readStatus: z.enum(["unread", "read"]).optional(),
    sentStartAt: MessageDateSchema.optional(),
    sentEndAt: MessageDateSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(10)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sentStartAt && value.sentEndAt && value.sentStartAt > value.sentEndAt) {
      context.addIssue({
        code: "custom",
        path: ["sentEndAt"],
        message: "End date must be on or after the start date"
      });
    }
  });

export const MessageListItemSchema = z
  .object({
    id: BusinessIdSchema,
    title: z.string().min(1).max(128),
    messageType: MessageTypeSchema,
    summary: z.string().max(255).nullable(),
    readStatus: z.boolean(),
    sentAt: z.string().min(1),
    readAt: z.string().min(1).nullable()
  })
  .strict();

export const MessageDetailSchema = MessageListItemSchema.extend({
  content: z.string(),
  senderId: BusinessIdSchema.nullable()
}).strict();

export const MessagePageSchema = createPaginatedResultSchema(MessageListItemSchema);

export const MarkMessagesReadRequestSchema = z.union([
  z.object({ ids: z.array(BusinessIdSchema).min(1).max(500) }).strict(),
  z.object({ all: z.literal(true) }).strict()
]);

export const MarkMessagesReadResponseSchema = z
  .object({ count: z.number().int().nonnegative() })
  .strict();

export type MessageListRequest = z.infer<typeof MessageListRequestSchema>;
export type MessageListItem = z.infer<typeof MessageListItemSchema>;
export type MessageDetail = z.infer<typeof MessageDetailSchema>;
export type MessagePage = z.infer<typeof MessagePageSchema>;
export type MarkMessagesReadRequest = z.infer<typeof MarkMessagesReadRequestSchema>;
