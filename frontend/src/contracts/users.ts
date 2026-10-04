import { z } from "zod";
import { BusinessIdSchema } from "./ids";
import { PermissionKeySchema, RoleCodeSchema } from "./permissions";
import { createPaginatedResultSchema } from "./pagination";

export const ManagedUserRoleSchema = z
  .object({
    id: BusinessIdSchema,
    code: RoleCodeSchema,
    name: z.string().min(1).max(128),
    isActive: z.boolean()
  })
  .strict();

export const ManagedUserSchema = z
  .object({
    id: BusinessIdSchema,
    userCode: z.string().nullable(),
    loginName: z.string().min(1).max(64),
    displayName: z.string().min(1).max(128),
    email: z.string().email().max(320),
    phone: z.string().nullable(),
    departmentId: BusinessIdSchema.nullable(),
    postId: BusinessIdSchema.nullable(),
    isActive: z.boolean(),
    roles: z.array(ManagedUserRoleSchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

export const UserManagementRoleOptionSchema = z
  .object({
    id: BusinessIdSchema,
    code: RoleCodeSchema,
    name: z.string().min(1).max(128)
  })
  .strict();

export const UserListRequestSchema = z
  .object({
    userCode: z.string().trim().max(64).optional(),
    loginName: z.string().trim().max(64).optional(),
    displayName: z.string().trim().max(128).optional(),
    phone: z.string().trim().max(32).optional(),
    departmentId: BusinessIdSchema.optional(),
    postId: BusinessIdSchema.optional(),
    status: z.enum(["active", "inactive"]).optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(10)
  })
  .strict();

export const UserListPageSchema = createPaginatedResultSchema(ManagedUserSchema);

const ManagedUserEditableFieldsSchema = z.object({
  userCode: z.string().trim().min(1).max(64),
  loginName: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(128),
  phone: z.string().trim().max(32).nullable(),
  departmentId: BusinessIdSchema.nullable(),
  postId: BusinessIdSchema.nullable()
});

export const CreateManagedUserRequestSchema = ManagedUserEditableFieldsSchema.extend({
  email: z.string().trim().email().max(320),
  roleIds: z.array(BusinessIdSchema).min(1).max(100)
}).strict();

export const UpdateManagedUserRequestSchema = ManagedUserEditableFieldsSchema.extend({
  id: BusinessIdSchema,
  roleIds: z.array(BusinessIdSchema).min(1).max(100).optional()
}).strict();

export const UserManagementRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), query: UserListRequestSchema }).strict(),
  z.object({ action: z.literal("roles") }).strict(),
  z.object({ action: z.literal("create"), input: CreateManagedUserRequestSchema }).strict(),
  z.object({ action: z.literal("update"), input: UpdateManagedUserRequestSchema }).strict(),
  z.object({
    action: z.literal("status"),
    id: BusinessIdSchema,
    isActive: z.boolean()
  }).strict(),
  z.object({ action: z.literal("delete"), id: BusinessIdSchema }).strict(),
  z.object({ action: z.literal("reset-password"), id: BusinessIdSchema }).strict()
]);

export const UserManagementMutationResultSchema = z
  .object({ user: ManagedUserSchema })
  .strict();

export const UserManagementDeleteResultSchema = z
  .object({ id: BusinessIdSchema, deleted: z.literal(true) })
  .strict();

export const UserManagementResetPasswordResultSchema = z
  .object({ message: z.string().min(1) })
  .strict();

export const UserManagementRoleOptionsSchema = z.array(UserManagementRoleOptionSchema);

export type ManagedUser = z.infer<typeof ManagedUserSchema>;
export type ManagedUserRole = z.infer<typeof ManagedUserRoleSchema>;
export type UserManagementRoleOption = z.infer<typeof UserManagementRoleOptionSchema>;
export type UserListRequest = z.infer<typeof UserListRequestSchema>;
export type UserListPage = z.infer<typeof UserListPageSchema>;
export type CreateManagedUserRequest = z.infer<typeof CreateManagedUserRequestSchema>;
export type UpdateManagedUserRequest = z.infer<typeof UpdateManagedUserRequestSchema>;
export type UserManagementRequest = z.infer<typeof UserManagementRequestSchema>;
