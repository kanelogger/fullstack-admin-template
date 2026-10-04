import {
  DeleteMenuRequestSchema,
  MenuCatalogSchema,
  SaveMenuRequestSchema,
  ManagedMenuSchema,
  type ManagedMenu
} from "@/contracts/menu-management";
import { MenuEntrySchema, type MenuEntry } from "@/contracts/menu";
import { getSupabaseClient } from "@/shared/supabase/client";

function resultError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

/** Reads the proposed, RLS-protected menu read model with BIGINT ids as text. */
export async function getMenuCatalog(): Promise<ManagedMenu[]> {
  const { data, error } = await getSupabaseClient().rpc("admin_menu_catalog");
  resultError(error, "菜单目录读取失败");
  return MenuCatalogSchema.parse(data);
}

/** Reads the caller-filtered navigation tree source through menu RLS. */
export async function getCurrentNavigation(): Promise<MenuEntry[]> {
  const { data, error } = await getSupabaseClient().rpc("current_navigation");
  resultError(error, "菜单路由读取失败");
  return MenuEntrySchema.array().parse(data);
}

export async function saveMenu(input: unknown): Promise<ManagedMenu> {
  const request = SaveMenuRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("save_admin_menu", {
    p_menu_id: request.id ?? null,
    p_parent_id: request.parentId,
    p_kind: request.kind,
    p_route_key: request.routeKey,
    p_path: request.path,
    p_title: request.title,
    p_icon: request.icon,
    p_sort_order: request.sortOrder,
    p_is_visible: request.isVisible,
    p_is_active: request.isActive,
    p_required_permission_key: request.requiredPermissionKey
  });
  resultError(error, "菜单保存失败");
  return ManagedMenuSchema.parse(data);
}

export async function deleteMenu(idInput: unknown): Promise<void> {
  const request = DeleteMenuRequestSchema.parse({ id: idInput });
  const { error } = await getSupabaseClient().rpc("delete_admin_menu", {
    p_menu_id: request.id
  });
  resultError(error, "菜单删除失败");
}
