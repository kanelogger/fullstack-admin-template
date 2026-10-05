import {
  DeleteMenuRequestSchema,
  MenuCatalogSchema,
  MenuPermissionCatalogSchema,
  SaveMenuRequestSchema,
  ManagedMenuSchema,
  type ManagedMenu
} from "@template/contracts/menu-management";
import { MenuEntrySchema, type MenuEntry } from "@template/contracts/menu";
import {
  MenuRoleCatalogSchema,
  ReplaceMenuRoleAuthorizationRequestSchema
} from "@template/contracts/role-management";
import { BusinessIdSchema } from "@template/contracts/ids";
import { getSupabaseClient } from "@/lib/supabase/client";

function resultError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

/** Reads the proposed, RLS-protected menu read model with BIGINT ids as text. */
export async function getMenuCatalog(): Promise<ManagedMenu[]> {
  const { data, error } = await getSupabaseClient().rpc("admin_menu_catalog");
  resultError(error, "菜单目录读取失败");
  return MenuCatalogSchema.parse(data);
}

export async function getMenuPermissionOptions() {
  const { data, error } = await getSupabaseClient().rpc("admin_menu_permission_catalog");
  resultError(error, "权限目录读取失败");
  return MenuPermissionCatalogSchema.parse(data);
}

export async function getMenuRoleCatalog(menuIdInput: unknown) {
  const menuId = BusinessIdSchema.parse(menuIdInput);
  const { data, error } = await getSupabaseClient().rpc("menu_role_catalog", {
    p_menu_id: menuId
  });
  resultError(error, "菜单授权读取失败");
  return MenuRoleCatalogSchema.parse(data);
}

export async function replaceMenuRoleAuthorization(input: unknown): Promise<void> {
  const request = ReplaceMenuRoleAuthorizationRequestSchema.parse(input);
  const { error } = await getSupabaseClient().rpc("replace_menu_role_authorization", {
    p_menu_id: request.menuId,
    p_role_ids: request.roleIds
  });
  resultError(error, "菜单角色授权保存失败");
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
