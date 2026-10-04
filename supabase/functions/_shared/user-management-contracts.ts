import { z } from "npm:zod@4.6.5";

const BusinessIdSchema = z.string().regex(/^[1-9]\d*$/);
const RoleCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const PermissionKeySchema = z.string().regex(
  /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/
);

export const ManagedUserRoleSchema = z.object({
  id: BusinessIdSchema,
  code: RoleCodeSchema,
  name: z.string().min(1).max(128),
  isActive: z.boolean()
}).strict();

export const ManagedUserSchema = z.object({
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
}).strict();

export const UserListRequestSchema = z.object({
  userCode: z.string().trim().max(64).optional(),
  loginName: z.string().trim().max(64).optional(),
  displayName: z.string().trim().max(128).optional(),
  phone: z.string().trim().max(32).optional(),
  departmentId: BusinessIdSchema.optional(),
  postId: BusinessIdSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10)
}).strict();

const roleIdsSchema = z.array(BusinessIdSchema).min(1).max(100).refine(
  ids => new Set(ids).size === ids.length,
  "Role IDs must be unique"
);

const EditableUserFieldsSchema = z.object({
  userCode: z.string().trim().min(1).max(64),
  loginName: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(128),
  phone: z.string().trim().max(32).nullable(),
  departmentId: BusinessIdSchema.nullable(),
  postId: BusinessIdSchema.nullable()
});

const CreateUserInputSchema = EditableUserFieldsSchema.extend({
  email: z.string().trim().email().max(320),
  roleIds: roleIdsSchema
}).strict();

const UpdateUserInputSchema = EditableUserFieldsSchema.extend({
  id: BusinessIdSchema,
  roleIds: roleIdsSchema.optional()
}).strict();

export const UserManagementRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), query: UserListRequestSchema }).strict(),
  z.object({ action: z.literal("roles") }).strict(),
  z.object({ action: z.literal("create"), input: CreateUserInputSchema }).strict(),
  z.object({ action: z.literal("update"), input: UpdateUserInputSchema }).strict(),
  z.object({ action: z.literal("status"), id: BusinessIdSchema, isActive: z.boolean() }).strict(),
  z.object({ action: z.literal("delete"), id: BusinessIdSchema }).strict(),
  z.object({ action: z.literal("reset-password"), id: BusinessIdSchema }).strict()
]);

export const ActorSchema = z.object({
  id: BusinessIdSchema,
  roleCodes: z.array(RoleCodeSchema),
  permissionKeys: z.array(PermissionKeySchema)
}).passthrough();

export const RoleOptionSchema = z.object({
  id: BusinessIdSchema,
  code: RoleCodeSchema,
  name: z.string().min(1).max(128)
}).strict();

export type UserManagementRequest = z.infer<typeof UserManagementRequestSchema>;
export type Actor = z.infer<typeof ActorSchema>;
