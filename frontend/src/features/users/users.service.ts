import {
  BusinessIdSchema,
  ErrorEnvelopeSchema,
  ManagedUserSchema,
  UserListPageSchema,
  UserListRequestSchema,
  UserManagementDeleteResultSchema,
  UserManagementRequestSchema,
  UserManagementResetPasswordResultSchema,
  UserManagementRoleOptionsSchema,
  UserManagementMutationResultSchema,
  CreateManagedUserRequestSchema,
  UpdateManagedUserRequestSchema,
  type CreateManagedUserRequest,
  type ManagedUser,
  type UserListPage,
  type UserListRequest,
  type UserManagementRoleOption
} from "@template/contracts";
import { getSupabaseClient } from "@/lib/supabase/client";

function failure(message: string): Error {
  return new Error(message);
}

async function functionError(error: unknown): Promise<Error | null> {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return null;
  try {
    const parsed = ErrorEnvelopeSchema.safeParse(await context.clone().json());
    return parsed.success ? failure(parsed.data.error.message) : null;
  } catch {
    return null;
  }
}

async function invoke(action: unknown): Promise<unknown> {
  const request = UserManagementRequestSchema.parse(action);
  const { data, error } = await getSupabaseClient().functions.invoke(
    "user-management",
    { body: request }
  );
  if (error) throw await functionError(error) ?? failure("用户管理请求失败");
  if (!data || typeof data !== "object") throw failure("用户管理服务返回了无效数据");
  const envelope = data as Record<string, unknown>;
  if (envelope.success !== true) {
    const parsed = ErrorEnvelopeSchema.safeParse(envelope);
    throw failure(parsed.success ? parsed.data.error.message : "用户管理请求失败");
  }
  return envelope.data;
}

export async function listManagedUsers(input: unknown): Promise<UserListPage> {
  const query: UserListRequest = UserListRequestSchema.parse(input);
  return UserListPageSchema.parse(await invoke({ action: "list", query }));
}

export async function getManagedUserRoles(): Promise<UserManagementRoleOption[]> {
  return UserManagementRoleOptionsSchema.parse(await invoke({ action: "roles" }));
}

export async function createManagedUser(input: unknown): Promise<ManagedUser> {
  const payload: CreateManagedUserRequest = CreateManagedUserRequestSchema.parse(input);
  const result = UserManagementMutationResultSchema.parse(
    await invoke({ action: "create", input: payload })
  );
  return result.user;
}

export async function updateManagedUser(input: unknown): Promise<ManagedUser> {
  const payload = UpdateManagedUserRequestSchema.parse(input);
  const result = UserManagementMutationResultSchema.parse(
    await invoke({ action: "update", input: payload })
  );
  return result.user;
}

export async function setManagedUserActive(
  idInput: unknown,
  isActive: boolean
): Promise<ManagedUser> {
  const id = BusinessIdSchema.parse(idInput);
  const result = UserManagementMutationResultSchema.parse(
    await invoke({ action: "status", id, isActive })
  );
  return result.user;
}

export async function deleteManagedUser(idInput: unknown): Promise<void> {
  const id = BusinessIdSchema.parse(idInput);
  UserManagementDeleteResultSchema.parse(await invoke({ action: "delete", id }));
}

export async function sendManagedUserPasswordReset(idInput: unknown): Promise<string> {
  const id = BusinessIdSchema.parse(idInput);
  const result = UserManagementResetPasswordResultSchema.parse(
    await invoke({ action: "reset-password", id })
  );
  return result.message;
}
