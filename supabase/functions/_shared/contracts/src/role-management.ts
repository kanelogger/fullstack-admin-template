import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { PermissionCatalogEntrySchema, PermissionKeySchema, RoleCodeSchema } from "./permissions.ts";
import { MenuCatalogSchema } from "./menu-management.ts";

export const RolePageRequestSchema = z.object({
  name: z.string().trim().max(128).optional(),
  code: z.string().trim().max(64).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10)
}).strict();

export const ManagedPermissionSchema = PermissionCatalogEntrySchema;

export const ManagedRoleSchema = z
  .object({
    id: BusinessIdSchema,
    code: RoleCodeSchema,
    name: z.string().trim().min(1).max(128),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    isActive: z.boolean(),
    userCount: z.number().int().nonnegative(),
    permissionKeys: z.array(PermissionKeySchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

export const RoleCatalogSchema = z
  .object({
    roles: z.array(ManagedRoleSchema),
    permissions: z.array(ManagedPermissionSchema),
    menus: MenuCatalogSchema,
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100)
  })
  .strict();

export const RoleMemberSchema = z.object({
  id: BusinessIdSchema,
  userCode: z.string().nullable(),
  loginName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  isActive: z.boolean()
}).strict();

export const RoleMembersPageRequestSchema = z.object({
  roleId: BusinessIdSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10)
}).strict();

export const RoleMembersPageSchema = z.object({
  items: z.array(RoleMemberSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100)
}).strict();

export const MenuRoleSchema = z.object({
  id: BusinessIdSchema,
  code: RoleCodeSchema,
  name: z.string().min(1).max(128),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  authorized: z.boolean()
}).strict();

export const MenuRoleCatalogSchema = z.object({
  permissionKey: PermissionKeySchema,
  sharedMenuCount: z.number().int().min(1),
  roles: z.array(MenuRoleSchema)
}).strict();

export const SaveRoleRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    code: RoleCodeSchema,
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().max(2000).nullable(),
    isActive: z.boolean()
  })
  .strict();

export const ReplaceRolePermissionsRequestSchema = z
  .object({
    roleId: BusinessIdSchema,
    permissionKeys: z.array(PermissionKeySchema).max(500)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.permissionKeys).size !== value.permissionKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["permissionKeys"],
        message: "Permission keys must be unique"
      });
    }
  });

export const ReplaceRoleAuthorizationRequestSchema = z
  .object({
    roleId: BusinessIdSchema,
    menuPermissionKeys: z.array(PermissionKeySchema).max(100),
    actionPermissionKeys: z.array(PermissionKeySchema).max(500)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.menuPermissionKeys).size !== value.menuPermissionKeys.length) {
      context.addIssue({ code: "custom", path: ["menuPermissionKeys"], message: "Menu permission keys must be unique" });
    }
    if (new Set(value.actionPermissionKeys).size !== value.actionPermissionKeys.length) {
      context.addIssue({ code: "custom", path: ["actionPermissionKeys"], message: "Action permission keys must be unique" });
    }
    if (value.menuPermissionKeys.some(key => value.actionPermissionKeys.includes(key))) {
      context.addIssue({ code: "custom", path: ["actionPermissionKeys"], message: "A permission key cannot belong to both groups" });
    }
  });

export const ReplaceMenuRoleAuthorizationRequestSchema = z
  .object({
    menuId: BusinessIdSchema,
    roleIds: z.array(BusinessIdSchema).max(500)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.roleIds).size !== value.roleIds.length) {
      context.addIssue({ code: "custom", path: ["roleIds"], message: "Role IDs must be unique" });
    }
  });

export const DeleteRoleRequestSchema = z
  .object({ id: BusinessIdSchema })
  .strict();

export type ManagedPermission = z.infer<typeof ManagedPermissionSchema>;
export type ManagedRole = z.infer<typeof ManagedRoleSchema>;
export type RoleCatalog = z.infer<typeof RoleCatalogSchema>;
export type RolePageRequest = z.infer<typeof RolePageRequestSchema>;
export type RoleMember = z.infer<typeof RoleMemberSchema>;
export type RoleMembersPageRequest = z.infer<typeof RoleMembersPageRequestSchema>;
export type RoleMembersPage = z.infer<typeof RoleMembersPageSchema>;
export type MenuRole = z.infer<typeof MenuRoleSchema>;
export type MenuRoleCatalog = z.infer<typeof MenuRoleCatalogSchema>;
export type SaveRoleRequest = z.infer<typeof SaveRoleRequestSchema>;
export type ReplaceRolePermissionsRequest = z.infer<
  typeof ReplaceRolePermissionsRequestSchema
>;
export type ReplaceRoleAuthorizationRequest = z.infer<typeof ReplaceRoleAuthorizationRequestSchema>;
export type ReplaceMenuRoleAuthorizationRequest = z.infer<typeof ReplaceMenuRoleAuthorizationRequestSchema>;
