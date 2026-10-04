import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  ActorSchema,
  UserManagementRequestSchema,
  type Actor,
  type UserManagementRequest
} from "../_shared/user-management-contracts.ts";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const appOrigin = Deno.env.get("APP_ORIGIN") ?? "http://127.0.0.1:8848";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase Edge Function environment is incomplete");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

type Permission =
  | "administration.users.read"
  | "administration.users.create"
  | "administration.users.update"
  | "administration.users.delete"
  | "administration.users.assign_roles"
  | "administration.users.reset_password";
type ListAction = Extract<UserManagementRequest, { action: "list" }>;
type CreateAction = Extract<UserManagementRequest, { action: "create" }>;
type UpdateAction = Extract<UserManagementRequest, { action: "update" }>;

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function errorResponse(request: Request, status: number, code: string, message: string) {
  return jsonResponse(request, status, {
    success: false,
    error: { code, message }
  });
}

async function recordOperation(
  actorId: string,
  action: string,
  targetId: string | null,
  active?: boolean
) {
  const operationType = action === "create"
    ? "CREATE"
    : action === "update"
      ? "UPDATE"
      : action === "status"
        ? "STATUS"
        : action === "delete"
          ? "DELETE"
          : "RESET_PASSWORD";
  const { error } = await adminClient.rpc("record_operation_event", {
    p_operator_id: actorId,
    p_module_code: "USER",
    p_operation_type: operationType,
    p_request_method: "POST",
    p_request_path: "/functions/v1/user-management",
    p_request_params: {
      action,
      ...(targetId ? { targetUserId: targetId } : {}),
      ...(active !== undefined ? { active } : {})
    }
  });
  if (error) console.error("user-management audit write failed", error.code);
}

async function recordException(request: Request, errorType: string, message: string) {
  const { error } = await adminClient.rpc("record_exception_event", {
    p_request_path: new URL(request.url).pathname.slice(0, 255),
    p_request_method: request.method.slice(0, 16),
    p_error_type: errorType.slice(0, 128),
    p_error_message: message.slice(0, 3000),
    p_stack_summary: null
  });
  if (error) console.error("user-management exception audit write failed", error.code);
}

function requiredPermission(action: string): Permission {
  switch (action) {
    case "list":
      return "administration.users.read";
    case "roles":
      return "administration.users.assign_roles";
    case "create":
      return "administration.users.create";
    case "update":
      return "administration.users.update";
    case "status":
      return "administration.users.update";
    case "delete":
      return "administration.users.delete";
    case "reset-password":
      return "administration.users.reset_password";
    default:
      throw new HttpFailure(400, "BAD_REQUEST", "用户管理操作无效");
  }
}

function isSuperAdmin(actor: Actor): boolean {
  return actor.roleCodes.includes("SUPER_ADMIN");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function mapUserRow(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new HttpFailure(500, "INTERNAL_ERROR", "用户数据格式无效");
  }
  const row = value as Record<string, unknown>;
  return {
    id: row.id,
    userCode: row.user_code,
    loginName: row.login_name,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    departmentId: row.department_id,
    postId: row.post_id,
    isActive: row.is_active,
    roles: row.roles,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getUserById(id: string) {
  const { data, error } = await adminClient
    .from("user_management_read_model")
    .select("id, user_code, login_name, display_name, email, phone, department_id, post_id, is_active, roles, created_at, updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new HttpFailure(500, "INTERNAL_ERROR", "用户读取失败");
  if (!data) throw new HttpFailure(404, "NOT_FOUND", "用户不存在");
  return mapUserRow(data);
}

async function listUsers(query: ListAction) {
  const filters = query.query;
  const from = (filters.page - 1) * filters.pageSize;
  let request = adminClient
    .from("user_management_read_model")
    .select("id, user_code, login_name, display_name, email, phone, department_id, post_id, is_active, roles, created_at, updated_at", { count: "exact" })
    .is("deleted_at", null);

  if (filters.userCode) request = request.ilike("user_code", `%${escapeLike(filters.userCode)}%`);
  if (filters.loginName) request = request.ilike("login_name", `%${escapeLike(filters.loginName)}%`);
  if (filters.displayName) request = request.ilike("display_name", `%${escapeLike(filters.displayName)}%`);
  if (filters.phone) request = request.ilike("phone", `%${escapeLike(filters.phone)}%`);
  if (filters.departmentId) request = request.eq("department_id", filters.departmentId);
  if (filters.postId) request = request.eq("post_id", filters.postId);
  if (filters.status) request = request.eq("is_active", filters.status === "active");

  const { data, error, count } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + filters.pageSize - 1);
  if (error) throw new HttpFailure(500, "INTERNAL_ERROR", "用户列表读取失败");

  return {
    items: (data ?? []).map(mapUserRow),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize
  };
}

async function listRoles(actor: Actor) {
  let query = adminClient
    .from("user_management_role_options")
    .select("id, code, name")
    .order("name", { ascending: true });
  if (!isSuperAdmin(actor)) query = query.neq("code", "SUPER_ADMIN");

  const { data, error } = await query;
  if (error) throw new HttpFailure(500, "INTERNAL_ERROR", "角色选项读取失败");
  return data ?? [];
}

async function sendPasswordReset(authUserId: string, email: string) {
  const { data: marked, error: markerError } = await adminClient.rpc(
    "mark_password_reset_requested",
    { p_auth_user_id: authUserId }
  );
  if (markerError || marked !== true) {
    throw new HttpFailure(409, "CONFLICT", "无法为该用户创建密码重置请求");
  }

  const { error } = await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${appOrigin}/#/reset-password`
  });
  if (error) {
    console.error("managed-user reset mail failed", error.code ?? error.status);
    throw new HttpFailure(503, "INTERNAL_ERROR", "重置邮件暂时无法发送");
  }
}

async function rollbackCreatedAuthUser(authUserId: string) {
  const { error: profileError } = await adminClient.rpc(
    "rollback_managed_user_create",
    { p_auth_user_id: authUserId }
  );
  if (profileError) {
    console.error("managed-user profile rollback failed", profileError.code);
    return;
  }
  const { error: userError } = await adminClient.auth.admin.deleteUser(authUserId);
  if (userError) console.error("managed-user Auth rollback failed", userError.code);
}

async function createUser(input: CreateAction) {
  const password = `${crypto.randomUUID()}aA1!`;
  const { data: authResult, error: authError } = await adminClient.auth.admin.createUser({
    email: input.input.email.toLowerCase(),
    password,
    email_confirm: true
  });
  if (authError || !authResult.user) {
    if (authError) console.error("managed-user Auth creation failed", authError.code);
    throw new HttpFailure(409, "CONFLICT", "邮箱已被使用或用户无法创建");
  }

  const { data: userId, error: profileError } = await adminClient.rpc(
    "create_managed_user_profile",
    {
      p_auth_user_id: authResult.user.id,
      p_user_code: input.input.userCode,
      p_login_name: input.input.loginName,
      p_display_name: input.input.displayName,
      p_email: input.input.email.toLowerCase(),
      p_phone: input.input.phone,
      p_department_id: input.input.departmentId,
      p_post_id: input.input.postId,
      p_role_ids: input.input.roleIds
    }
  );
  if (profileError || typeof userId !== "string") {
    await rollbackCreatedAuthUser(authResult.user.id);
    if (profileError) {
      console.error("managed-user profile creation failed", profileError.code);
      if (profileError.code === "23505") {
        throw new HttpFailure(409, "CONFLICT", "工号、登录名或邮箱已存在");
      }
    }
    throw new HttpFailure(400, "VALIDATION_ERROR", "用户资料无法保存，请检查角色和资料字段");
  }

  try {
    await sendPasswordReset(authResult.user.id, input.input.email.toLowerCase());
    return { user: await getUserById(userId) };
  } catch (error) {
    await rollbackCreatedAuthUser(authResult.user.id);
    throw error;
  }
}

async function updateUser(input: UpdateAction) {
  const { error } = await adminClient.rpc("update_managed_user_profile", {
    p_profile_id: input.input.id,
    p_user_code: input.input.userCode,
    p_login_name: input.input.loginName,
    p_display_name: input.input.displayName,
    p_phone: input.input.phone,
    p_department_id: input.input.departmentId,
    p_post_id: input.input.postId,
    p_role_ids: input.input.roleIds ?? null
  });
  if (error) {
    console.error("managed-user update failed", error.code);
    if (error.code === "23505") throw new HttpFailure(409, "CONFLICT", "工号或登录名已存在");
    throw new HttpFailure(400, "VALIDATION_ERROR", "用户资料无法保存，请检查角色和资料字段");
  }
  return { user: await getUserById(input.input.id) };
}

Deno.serve(async request => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return errorResponse(request, 405, "METHOD_NOT_ALLOWED", "仅支持 POST 请求");
  }

  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new HttpFailure(401, "UNAUTHORIZED", "登录状态已失效");
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } }
    });
    const { data: actorData, error: actorError } = await callerClient.rpc("current_profile");
    const actorResult = ActorSchema.safeParse(actorData);
    if (actorError || !actorResult.success) {
      throw new HttpFailure(401, "UNAUTHORIZED", "应用会话无效，请重新登录");
    }
    const actor = actorResult.data;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpFailure(400, "BAD_REQUEST", "请求内容格式无效");
    }
    const parsed = UserManagementRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpFailure(400, "BAD_REQUEST", "用户管理请求格式无效");
    }
    const input = parsed.data;
    const required = requiredPermission(input.action);
    if (!actor.permissionKeys.includes(required)) {
      throw new HttpFailure(403, "FORBIDDEN", "没有执行该用户管理操作的权限");
    }
    if (input.action === "create" &&
      !actor.permissionKeys.includes("administration.users.assign_roles")) {
      throw new HttpFailure(403, "FORBIDDEN", "没有分配用户角色的权限");
    }
    if (input.action === "create" || input.action === "update") {
      const roleIds = input.input.roleIds;
      if (roleIds && !actor.permissionKeys.includes("administration.users.assign_roles")) {
        throw new HttpFailure(403, "FORBIDDEN", "没有分配用户角色的权限");
      }
      if (roleIds && !isSuperAdmin(actor)) {
        const { data: roles, error: rolesError } = await adminClient
          .from("roles")
          .select("id")
          .eq("code", "SUPER_ADMIN")
          .in("id", roleIds);
        if (rolesError) throw new HttpFailure(500, "INTERNAL_ERROR", "角色校验失败");
        if (roles?.length) throw new HttpFailure(403, "FORBIDDEN", "只有超级管理员可以分配超级管理员角色");
      }
    }

    let data: unknown;
    switch (input.action) {
      case "list":
        data = await listUsers(input);
        break;
      case "roles":
        data = await listRoles(actor);
        break;
      case "create":
        data = await createUser(input);
        break;
      case "update":
        data = await updateUser(input);
        break;
      case "status": {
        if (input.id === actor.id && !input.isActive) {
          throw new HttpFailure(409, "CONFLICT", "不能停用当前登录账号");
        }
        const { data: updated, error } = await adminClient.rpc("set_managed_user_active", {
          p_profile_id: input.id,
          p_is_active: input.isActive
        });
        if (error || updated !== true) throw new HttpFailure(404, "NOT_FOUND", "用户不存在");
        data = { user: await getUserById(input.id) };
        break;
      }
      case "delete": {
        if (input.id === actor.id) {
          throw new HttpFailure(409, "CONFLICT", "不能删除当前登录账号");
        }
        const { data: deleted, error } = await adminClient.rpc("soft_delete_managed_user", {
          p_profile_id: input.id
        });
        if (error || deleted !== true) throw new HttpFailure(404, "NOT_FOUND", "用户不存在");
        data = { id: input.id, deleted: true };
        break;
      }
      case "reset-password": {
        const { data: target, error } = await adminClient
          .from("user_management_read_model")
          .select("auth_user_id, email, is_active")
          .eq("id", input.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw new HttpFailure(500, "INTERNAL_ERROR", "用户读取失败");
        if (!target || !target.is_active || typeof target.auth_user_id !== "string") {
          throw new HttpFailure(404, "NOT_FOUND", "有效的 Auth 用户不存在");
        }
        await sendPasswordReset(target.auth_user_id, target.email as string);
        data = { message: "密码重置邮件已发送" };
        break;
      }
    }

    if (!new Set(["list", "roles"]).has(input.action)) {
      let targetId: string | null = null;
      switch (input.action) {
        case "create":
          targetId = (data as { user?: { id?: string } } | null)?.user?.id ?? null;
          break;
        case "update":
          targetId = input.input.id;
          break;
        case "status":
        case "delete":
        case "reset-password":
          targetId = input.id;
          break;
        default:
          break;
      }
      await recordOperation(
        actor.id,
        input.action,
        targetId,
        input.action === "status" ? input.isActive : undefined
      );
    }

    return jsonResponse(request, 200, { success: true, data });
  } catch (error) {
    if (error instanceof HttpFailure) {
      if (error.status >= 500) {
        await recordException(request, error.code, "User management operation failed");
      }
      return errorResponse(request, error.status, error.code, error.message);
    }
    console.error("user-management failed", (error as { code?: string })?.code);
    await recordException(request, "UnhandledError", "User management request failed unexpectedly");
    return errorResponse(request, 500, "INTERNAL_ERROR", "用户管理服务暂时不可用");
  }
});
