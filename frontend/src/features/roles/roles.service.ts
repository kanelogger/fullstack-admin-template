import {
  DeleteRoleRequestSchema,
  RoleCatalogSchema,
  ManagedRoleSchema,
  SaveRoleRequestSchema,
  ReplaceRolePermissionsRequestSchema,
  type ManagedRole
} from "@/contracts/role-management";
import { getSupabaseClient } from "@/shared/supabase/client";

function resultError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

/**
 * The catalog RPC must cast role BIGINT ids to decimal text inside jsonb.
 * A direct PostgREST BIGINT projection can pass through JavaScript Number.
 */
export async function getRoleCatalog() {
  const { data, error } = await getSupabaseClient().rpc("admin_role_catalog");
  resultError(error, "角色目录读取失败");
  return RoleCatalogSchema.parse(data);
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

/** Replaces the complete permission set atomically in one database transaction. */
export async function replaceRolePermissions(input: unknown): Promise<void> {
  const request = ReplaceRolePermissionsRequestSchema.parse(input);
  const { error } = await getSupabaseClient().rpc("replace_role_permissions", {
    p_role_id: request.roleId,
    p_permission_keys: request.permissionKeys
  });
  resultError(error, "角色权限保存失败");
}

export async function deleteRole(idInput: unknown): Promise<void> {
  const request = DeleteRoleRequestSchema.parse({ id: idInput });
  const { error } = await getSupabaseClient().rpc("delete_admin_role", {
    p_role_id: request.id
  });
  resultError(error, "角色删除失败");
}
