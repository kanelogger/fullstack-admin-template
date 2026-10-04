import { AppError } from "../utils/errors";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type JwtPayload,
} from "../utils/jwt";
import config from "../config";
import { getUserById } from "./users";

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expires: string;
}

function hasPasswordAuthenticationMethod(accessToken: string): boolean {
  const encodedPayload = accessToken.split(".")[1];
  if (!encodedPayload) return false;

  try {
    const claims = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as { amr?: unknown };
    return Array.isArray(claims.amr) && claims.amr.some(
      method =>
        method !== null &&
        typeof method === "object" &&
        "method" in method &&
        method.method === "password"
    );
  } catch {
    return false;
  }
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResult> {
  let payload: JwtPayload;
  try {
    payload = verifyToken(refreshToken);
  } catch {
    throw new AppError("UNAUTHORIZED", "刷新令牌无效或已过期");
  }

  if (payload.type !== "refresh") {
    throw new AppError("UNAUTHORIZED", "令牌类型无效");
  }

  return buildTokenResult(payload.userId, payload.username);
}

/** Verify a Supabase session, resolve its own BIGINT profile ID, then issue a
 * short-lived JWT so unmigrated Fastify modules can keep serving the user. */
export async function exchangeSupabaseSession(
  accessToken: string
): Promise<TokenResult> {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new AppError("INTERNAL_ERROR", "Supabase 会话桥接尚未配置");
  }

  let authResponse: Response;
  try {
    authResponse = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch {
    throw new AppError("INTERNAL_ERROR", "Supabase 身份服务暂不可用");
  }

  if (authResponse.status === 401 || authResponse.status === 403) {
    throw new AppError("UNAUTHORIZED", "Supabase 会话无效或已过期");
  }
  if (!authResponse.ok) {
    throw new AppError("INTERNAL_ERROR", "Supabase 身份校验失败");
  }

  const authUser = await authResponse.json() as { id?: unknown };
  if (typeof authUser.id !== "string") {
    throw new AppError("UNAUTHORIZED", "Supabase 会话无效");
  }
  // The Auth endpoint has other session methods (for example email OTP). The
  // user endpoint above verifies the JWT signature; accept only password AMR
  // before issuing a legacy token to old Fastify modules.
  if (!hasPasswordAuthenticationMethod(accessToken)) {
    throw new AppError("UNAUTHORIZED", "仅支持账号密码登录创建的会话");
  }

  let profileResponse: Response;
  try {
    profileResponse = await fetch(
      `${config.supabaseUrl}/rest/v1/rpc/current_business_user_id`,
      {
        method: "POST",
        headers: {
          apikey: config.supabasePublishableKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );
  } catch {
    throw new AppError("INTERNAL_ERROR", "Supabase 用户映射服务暂不可用");
  }

  if (profileResponse.status === 401 || profileResponse.status === 403) {
    throw new AppError("UNAUTHORIZED", "Supabase 会话无效或已过期");
  }
  if (!profileResponse.ok) {
    throw new AppError("INTERNAL_ERROR", "Supabase 用户映射失败");
  }

  const businessUserId = await profileResponse.json() as unknown;
  if (typeof businessUserId !== "string" || !/^[1-9]\d*$/.test(businessUserId)) {
    throw new AppError("UNAUTHORIZED", "该 Supabase 账号尚未映射到业务用户");
  }

  const userId = Number(businessUserId);
  if (!Number.isSafeInteger(userId)) {
    throw new AppError("CONFLICT", "该业务用户 ID 暂不受旧模块兼容接口支持");
  }

  const user = await getUserById(userId);
  if (!user || user.status !== 1) {
    throw new AppError("USER_DISABLED", "业务账号不存在或已停用");
  }

  return buildTokenResult(user.id, user.login_name);
}

function buildTokenResult(userId: number, username: string): TokenResult {
  const payload = { userId, username };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // expires 为 accessToken 过期时间 ISO 字符串
  const expires = new Date(
    Date.now() + config.accessTokenTtlMinutes * 60 * 1000
  ).toISOString();

  return { accessToken, refreshToken, expires };
}
