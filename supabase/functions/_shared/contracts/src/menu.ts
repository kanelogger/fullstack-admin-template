import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";
import { PermissionKeySchema } from "./permissions.ts";
import { ManagedMenuKindSchema, ManagedRouteKeySchema } from "./menu-management.ts";

export const RouteKeySchema = ManagedRouteKeySchema;

const routePathPattern = /^(?:\/|(?:\/[a-zA-Z0-9_:-]+)+\/?$)/;

export const MenuEntrySchema = z
  .object({
    id: BusinessIdSchema,
    parentId: BusinessIdSchema.nullable(),
    kind: ManagedMenuKindSchema,
    routeKey: RouteKeySchema.nullable(),
    path: z.string().regex(routePathPattern),
    title: z.string().min(1).max(128),
    icon: z.string().max(128).nullable(),
    sortOrder: z.number().int(),
    requiredPermissionKey: PermissionKeySchema.nullable()
  })
  .strict()
  .superRefine((menu, context) => {
    if (menu.kind === "group" && menu.routeKey !== null) {
      context.addIssue({
        code: "custom",
        path: ["routeKey"],
        message: "Group menu cannot select a route component"
      });
    }
    if (menu.kind === "route" && menu.routeKey === null) {
      context.addIssue({
        code: "custom",
        path: ["routeKey"],
        message: "Route menu requires a registered RouteKey"
      });
    }
  });

export const MenuSchema = z.array(MenuEntrySchema);

export type RouteKey = z.infer<typeof RouteKeySchema>;
export type MenuEntry = z.infer<typeof MenuEntrySchema>;
