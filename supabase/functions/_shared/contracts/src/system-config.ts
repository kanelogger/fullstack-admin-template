import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { createPaginatedResultSchema, PaginationRequestSchema } from "./pagination.ts";

export const SystemConfigValueTypeSchema = z.enum([
  "STRING",
  "NUMBER",
  "BOOLEAN",
  "JSON"
]);

/** Match the legacy service: uppercase recognized types; unknown values become STRING. */
const SystemConfigValueTypeInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(SystemConfigValueTypeSchema)
  .catch("STRING")
  .default("STRING");

export const SystemConfigStatusSchema = z.union([z.literal(0), z.literal(1)]);

export const SystemConfigSchema = z
  .object({
    id: BusinessIdSchema,
    configCode: z.string().min(1).max(64),
    configName: z.string().min(1).max(128),
    configValue: z.string(),
    valueType: SystemConfigValueTypeSchema,
    status: SystemConfigStatusSchema,
    description: z.string().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

export const SystemConfigValueSchema = z
  .object({
    configCode: z.string().min(1).max(64),
    configValue: z.string(),
    valueType: SystemConfigValueTypeSchema
  })
  .strict();

export const SystemConfigListRequestSchema = z
  .object({
    configCode: z.string().trim().max(64).optional(),
    configName: z.string().trim().max(128).optional(),
    status: SystemConfigStatusSchema.optional(),
    ...PaginationRequestSchema.shape
  })
  .strict();

export const SystemConfigListPageSchema = createPaginatedResultSchema(
  SystemConfigSchema
);

export const SaveSystemConfigRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    configCode: z.string().trim().min(1).max(64),
    configName: z.string().trim().min(1).max(128),
    configValue: z.string().trim().min(1),
    valueType: SystemConfigValueTypeInputSchema,
    status: SystemConfigStatusSchema.default(1),
    description: z.string().trim().max(255).nullable().default(null)
  })
  .strict();

export const DeleteSystemConfigRequestSchema = z
  .object({ id: BusinessIdSchema })
  .strict();

export type SystemConfig = z.infer<typeof SystemConfigSchema>;
export type SystemConfigValue = z.infer<typeof SystemConfigValueSchema>;
export type SystemConfigListRequest = z.infer<
  typeof SystemConfigListRequestSchema
>;
export type SystemConfigListPage = z.infer<typeof SystemConfigListPageSchema>;
export type SaveSystemConfigRequest = z.infer<
  typeof SaveSystemConfigRequestSchema
>;
