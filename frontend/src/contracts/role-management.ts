import { z } from "zod";
import { BusinessIdSchema } from "./ids";
import { PermissionKeySchema, RoleCodeSchema } from "./permissions";

export const ManagedPermissionSchema = z
  .object({
    key: PermissionKeySchema,
    description: z.string().min(1).max(256)
  })
  .strict();

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
    permissions: z.array(ManagedPermissionSchema)
  })
  .strict();

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

export const DeleteRoleRequestSchema = z
  .object({ id: BusinessIdSchema })
  .strict();

export type ManagedPermission = z.infer<typeof ManagedPermissionSchema>;
export type ManagedRole = z.infer<typeof ManagedRoleSchema>;
export type RoleCatalog = z.infer<typeof RoleCatalogSchema>;
export type SaveRoleRequest = z.infer<typeof SaveRoleRequestSchema>;
export type ReplaceRolePermissionsRequest = z.infer<
  typeof ReplaceRolePermissionsRequestSchema
>;
