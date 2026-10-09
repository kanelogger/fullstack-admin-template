import {
  DeleteRoleRequestSchema,
  RoleCatalogSchema,
  RoleMembersPageSchema,
  RoleMembersPageRequestSchema,
  ManagedRoleSchema,
  RolePageRequestSchema,
  ReplaceRoleAuthorizationRequestSchema,
  SaveRoleRequestSchema,
  type ManagedRole
} from "@template/contracts/role-management";
import { getSupabaseClient } from "@/lib/supabase/client";

function resultError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

/**
 * The catalog RPC must cast role BIGINT ids to decimal text inside jsonb.
 * A direct PostgREST BIGINT projection can pass through JavaScript Number.
 */
export async function getRoleCatalog(input: unknown = {}) {
  const request = RolePageRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("admin_roles_page", {
    p_name: request.name ?? null,
    p_code: request.code ?? null,
    p_status: request.status,
    p_page: request.page,
    p_page_size: request.pageSize
  });
  resultError(error, "角色目录读取失败");
  return RoleCatalogSchema.parse(data);
}

export async function getRoleMembers(input: unknown) {
  const request = RoleMembersPageRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("admin_role_members", {
    p_role_id: request.roleId,
    p_page: request.page,
    p_page_size: request.pageSize
  });
  resultError(error, "角色成员读取失败");
  return RoleMembersPageSchema.parse(data);
}

export async function saveRole(input: unknown): Promise<ManagedRole> {
  const request = SaveRoleRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("save_admin_role", {
    p_role_id: request.id ?? null,
    p_code: request.code,
    p_name: request.name,
    p_description: request.description,
    p_is_active: request.isActive
  });
  resultError(error, "角色保存失败");
  return ManagedRoleSchema.parse(data);
}

export async function replaceRoleAuthorization(input: unknown): Promise<void> {
  const request = ReplaceRoleAuthorizationRequestSchema.parse(input);
  const { error } = await getSupabaseClient().rpc("replace_role_authorization", {
    p_role_id: request.roleId,
    p_menu_permission_keys: request.menuPermissionKeys,
    p_action_permission_keys: request.actionPermissionKeys
  });
  resultError(error, "角色授权保存失败");
}

export async function deleteRole(idInput: unknown): Promise<void> {
  const request = DeleteRoleRequestSchema.parse({ id: idInput });
  const { error } = await getSupabaseClient().rpc("delete_admin_role", {
    p_role_id: request.id
  });
  resultError(error, "角色删除失败");
}
