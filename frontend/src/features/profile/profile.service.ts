import {
  ProfileUpdateRequestSchema,
  SessionSchema,
  type Profile,
  type ProfileUpdateRequest,
  type Session
} from "@template/contracts";
import { getSupabaseClient } from "@/lib/supabase/client";
import { AuthSessionRejectedError, isExplicitAuthRejection } from "@/features/auth/session-errors";

export class ProfileServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(sourceError: { message: string; code?: string }, status: number) {
    super(sourceError.message, { cause: sourceError });
    this.name = "ProfileServiceError";
    this.code = sourceError.code ?? "";
    this.status = status;
  }
}

function toSession(value: unknown): Session {
  if (!value || typeof value !== "object") {
    throw new Error("Supabase 没有返回当前用户资料");
  }

  const row = value as Record<string, unknown>;
  const { roleCodes, permissionKeys, mustResetPassword, ...profile } = row;
  return SessionSchema.parse({
    profile,
    roleCodes,
    permissionKeys,
    mustResetPassword
  });
}

export async function getCurrentSession(): Promise<Session> {
  const { data, error, status } = await getSupabaseClient().rpc("current_profile");
  if (error) {
    if (isExplicitAuthRejection(error, status)) {
      throw new AuthSessionRejectedError("当前登录状态已被资料接口拒绝", { cause: error });
    }
    throw new ProfileServiceError(error, status);
  }
  if (data == null) throw new AuthSessionRejectedError("当前登录没有可用的个人资料");
  return toSession(data);
}

export async function getCurrentProfile(): Promise<Profile> {
  const session = await getCurrentSession();
  return session.profile;
}

export async function updateCurrentProfile(input: unknown): Promise<Profile> {
  const update: ProfileUpdateRequest = ProfileUpdateRequestSchema.parse(input);
  const client = getSupabaseClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) {
    throw new Error("登录状态已失效，请重新登录");
  }

  const { data, error } = await client
    .from("profiles")
    .update({
      display_name: update.displayName,
      phone: update.phone || null
    })
    .eq("auth_user_id", userResult.user.id)
    .select("auth_user_id")
    .single();

  if (error || data?.auth_user_id !== userResult.user.id) {
    throw new Error("资料保存失败，请检查权限后重试");
  }

  return getCurrentProfile();
}
