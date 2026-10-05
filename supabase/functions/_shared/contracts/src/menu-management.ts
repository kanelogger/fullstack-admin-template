import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { PermissionCatalogEntrySchema, PermissionKeySchema } from "./permissions.ts";

export const ManagedMenuKindSchema = z.enum(["group", "route"]);
/** Closed allowlist paired with the frontend's local component registry. */
export const ManagedRouteKeySchema = z.enum([
  "dashboard.overview",
  "account.profile",
  "account.change-password",
  "communication.messages",
  "operation.attachments",
  "administration.users",
  "administration.roles",
  "administration.menus",
  "administration.departments",
  "administration.posts",
  "administration.dictionaries",
  "administration.configurations",
  "audit.login-logs",
  "audit.operation-logs",
  "audit.exception-logs"
]);

export const ManagedMenuSchema = z
  .object({
    id: BusinessIdSchema,
    parentId: BusinessIdSchema.nullable(),
    kind: ManagedMenuKindSchema,
    routeKey: ManagedRouteKeySchema.nullable(),
    path: z.string().regex(/^(?:\/|(?:\/[a-zA-Z0-9_:-]+)+\/?$)/),
    title: z.string().trim().min(1).max(128),
    icon: z.string().max(128).nullable(),
    sortOrder: z.number().int(),
    isVisible: z.boolean(),
    isActive: z.boolean(),
    requiredPermissionKey: PermissionKeySchema.nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict()
  .superRefine((menu, context) => {
    if (menu.kind === "group" && menu.routeKey !== null) {
      context.addIssue({
        code: "custom",
        path: ["routeKey"],
        message: "Group menus cannot select a route component"
      });
    }
    if (menu.kind === "route" && menu.routeKey === null) {
      context.addIssue({
        code: "custom",
        path: ["routeKey"],
        message: "Route menus require an approved route key"
      });
    }
    if (menu.kind === "route" && menu.requiredPermissionKey === null) {
      context.addIssue({
        code: "custom",
        path: ["requiredPermissionKey"],
        message: "Route menus require an access permission key"
      });
    }
  });

export const MenuCatalogSchema = z.array(ManagedMenuSchema);
export const MenuPermissionCatalogSchema = z.array(PermissionCatalogEntrySchema);

export const SaveMenuRequestSchema = z
  .object({
    id: BusinessIdSchema.optional(),
    parentId: BusinessIdSchema.nullable(),
    kind: ManagedMenuKindSchema,
    routeKey: ManagedRouteKeySchema.nullable(),
    path: z.string().regex(/^(?:\/|(?:\/[a-zA-Z0-9_:-]+)+\/?$)/),
    title: z.string().trim().min(1).max(128),
    icon: z.string().trim().max(128).nullable(),
    sortOrder: z.number().int().min(0).max(100000),
    isVisible: z.boolean(),
    isActive: z.boolean(),
    requiredPermissionKey: PermissionKeySchema.nullable()
  })
  .strict()
  .superRefine((menu, context) => {
    if (menu.kind === "group" && (menu.routeKey !== null || menu.requiredPermissionKey !== null)) {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Group menus cannot bind a route or required permission"
      });
    }
    if (menu.kind === "route" && menu.routeKey === null) {
      context.addIssue({
        code: "custom",
        path: ["routeKey"],
        message: "Choose a registered route key"
      });
    }
    if (menu.kind === "route" && menu.requiredPermissionKey === null) {
      context.addIssue({
        code: "custom",
        path: ["requiredPermissionKey"],
        message: "Route menus require an access permission key"
      });
    }
  });

export const DeleteMenuRequestSchema = z
  .object({ id: BusinessIdSchema })
  .strict();

export type ManagedMenu = z.infer<typeof ManagedMenuSchema>;
export type MenuCatalog = z.infer<typeof MenuCatalogSchema>;
export type SaveMenuRequest = z.infer<typeof SaveMenuRequestSchema>;
export type ManagedMenuKind = z.infer<typeof ManagedMenuKindSchema>;
export type ManagedRouteKey = z.infer<typeof ManagedRouteKeySchema>;
