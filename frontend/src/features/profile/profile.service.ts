import {
  ProfileUpdateRequestSchema,
  SessionSchema,
  type Profile,
  type ProfileUpdateRequest,
  type Session
} from "@/contracts";
import { getSupabaseClient } from "@/shared/supabase/client";

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
  const { data, error } = await getSupabaseClient().rpc("current_profile");
  if (error) throw new Error("个人资料读取失败，请重新登录后重试");
  return toSession(data);
}

export async function getCurrentProfile(): Promise<Profile> {
  const session = await getCurrentSession();
  return session.profile;
}

export async function updateCurrentProfile(
  input: unknown
): Promise<Profile> {
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
