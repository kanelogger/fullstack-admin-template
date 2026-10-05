import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { createPaginatedResultSchema } from "./pagination.ts";

export const OrganizationStatusSchema = z.union([z.literal(0), z.literal(1)]);

const CodeSchema = z.string().trim().min(1).max(64);
const NameSchema = z.string().trim().min(1).max(128);
const DescriptionSchema = z
  .string()
  .trim()
  .max(255)
  .transform(value => value || null)
  .nullable()
  .default(null);
const TimestampSchema = z.string().datetime({ offset: true });

export const DepartmentSchema = z
  .object({
    id: BusinessIdSchema,
    deptCode: CodeSchema,
    deptName: NameSchema,
    status: OrganizationStatusSchema,
    description: z.string().nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

export const PostSchema = z
  .object({
    id: BusinessIdSchema,
    postCode: CodeSchema,
    postName: NameSchema,
    status: OrganizationStatusSchema,
    description: z.string().nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

const PaginationFields = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10),
  status: OrganizationStatusSchema.optional()
};

export const DepartmentListRequestSchema = z
  .object({
    ...PaginationFields,
    deptCode: z.string().trim().max(64).optional(),
    deptName: z.string().trim().max(128).optional()
  })
  .strict();

export const PostListRequestSchema = z
  .object({
    ...PaginationFields,
    postCode: z.string().trim().max(64).optional(),
    postName: z.string().trim().max(128).optional()
  })
  .strict();

export const SaveDepartmentRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    deptCode: CodeSchema,
    deptName: NameSchema,
    status: OrganizationStatusSchema.default(1),
    description: DescriptionSchema
  })
  .strict();

export const SavePostRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    postCode: CodeSchema,
    postName: NameSchema,
    status: OrganizationStatusSchema.default(1),
    description: DescriptionSchema
  })
  .strict();

export const DeleteOrganizationRequestSchema = z
  .object({ id: BusinessIdSchema })
  .strict();

export const DepartmentPageSchema = createPaginatedResultSchema(DepartmentSchema);
export const PostPageSchema = createPaginatedResultSchema(PostSchema);

export type Department = z.infer<typeof DepartmentSchema>;
export type Post = z.infer<typeof PostSchema>;
export type DepartmentListRequest = z.infer<typeof DepartmentListRequestSchema>;
export type PostListRequest = z.infer<typeof PostListRequestSchema>;
export type SaveDepartmentRequest = z.infer<typeof SaveDepartmentRequestSchema>;
export type SavePostRequest = z.infer<typeof SavePostRequestSchema>;
export type DepartmentPage = z.infer<typeof DepartmentPageSchema>;
export type PostPage = z.infer<typeof PostPageSchema>;
