import { z } from "zod";

/** Stable module.resource.action key; menu visibility is not an authorization check. */
export const PermissionKeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/,
    "Expected a module.resource.action permission key"
  );

export const RoleCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);

export const PermissionCatalogEntrySchema = z.object({
  key: PermissionKeySchema,
  description: z.string().min(1).max(256)
}).strict();

export type PermissionKey = z.infer<typeof PermissionKeySchema>;
export type RoleCode = z.infer<typeof RoleCodeSchema>;
export type PermissionCatalogEntry = z.infer<typeof PermissionCatalogEntrySchema>;
