import { z } from "zod";
import { BusinessIdSchema } from "./ids";
import { createPaginatedResultSchema, PaginationRequestSchema } from "./pagination";

export const DictionaryStatusSchema = z.union([z.literal(0), z.literal(1)]);

const DictionaryFiltersSchema = z.object({
  dictCode: z.string().trim().max(64).optional(),
  dictName: z.string().trim().max(128).optional(),
  status: DictionaryStatusSchema.optional()
});

export const DictionaryTypeSchema = z
  .object({
    id: BusinessIdSchema,
    dictCode: z.string().min(1).max(64),
    dictName: z.string().min(1).max(128),
    status: DictionaryStatusSchema,
    description: z.string().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

export const DictionaryItemSchema = z
  .object({
    id: BusinessIdSchema,
    dictTypeId: BusinessIdSchema,
    itemValue: z.string().min(1).max(64),
    itemLabel: z.string().min(1).max(128),
    sortOrder: z.number().int().min(-2147483648).max(2147483647),
    status: DictionaryStatusSchema,
    description: z.string().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

export const DictionaryOptionSchema = z
  .object({
    id: BusinessIdSchema,
    label: z.string().min(1).max(128),
    value: z.string().min(1).max(64),
    status: DictionaryStatusSchema
  })
  .strict();

export const DictionaryTypeListRequestSchema = DictionaryFiltersSchema.extend(
  PaginationRequestSchema.shape
)
  .strict();

export const DictionaryTypeListPageSchema = createPaginatedResultSchema(
  DictionaryTypeSchema
);

export const SaveDictionaryTypeRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    dictCode: z.string().trim().min(1).max(64),
    dictName: z.string().trim().min(1).max(128),
    status: DictionaryStatusSchema.default(1),
    description: z.string().trim().max(255).nullable().default(null)
  })
  .strict();

export const SaveDictionaryItemRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    dictTypeId: BusinessIdSchema,
    itemValue: z.string().trim().min(1).max(64),
    itemLabel: z.string().trim().min(1).max(128),
    sortOrder: z.number().int().min(-2147483648).max(2147483647).default(0),
    status: DictionaryStatusSchema.default(1),
    description: z.string().trim().max(255).nullable().default(null)
  })
  .strict();

export const ReplaceDictionaryItemOrderRequestSchema = z
  .object({
    dictTypeId: BusinessIdSchema,
    items: z
      .array(
        z
          .object({
            id: BusinessIdSchema,
            sortOrder: z.number().int().min(-2147483648).max(2147483647)
          })
          .strict()
      )
      .max(500)
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.items.map(item => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Dictionary item IDs must be unique"
      });
    }
  });

export const DictionaryOptionsRequestSchema = z
  .object({
    dictCode: z.string().trim().min(1).max(64),
    enabledOnly: z.boolean().default(true)
  })
  .strict();

export const DictionaryOptionsSchema = z.array(DictionaryOptionSchema);

export type DictionaryType = z.infer<typeof DictionaryTypeSchema>;
export type DictionaryItem = z.infer<typeof DictionaryItemSchema>;
export type DictionaryOption = z.infer<typeof DictionaryOptionSchema>;
export type DictionaryTypeListRequest = z.infer<
  typeof DictionaryTypeListRequestSchema
>;
export type DictionaryTypeListPage = z.infer<typeof DictionaryTypeListPageSchema>;
export type SaveDictionaryTypeRequest = z.infer<
  typeof SaveDictionaryTypeRequestSchema
>;
export type SaveDictionaryItemRequest = z.infer<
  typeof SaveDictionaryItemRequestSchema
>;
export type ReplaceDictionaryItemOrderRequest = z.infer<
  typeof ReplaceDictionaryItemOrderRequestSchema
>;
