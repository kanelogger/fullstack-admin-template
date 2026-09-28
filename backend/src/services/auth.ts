import { pool } from "../db/mysql";
import { AppError } from "../utils/errors";
import { verifyPassword } from "../utils/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type JwtPayload,
} from "../utils/jwt";
import config from "../config";
import {
  findUserByLoginName,
  getUserRoles,
  updateLastLoginAt,
  type UserRow,
} from "./users";
import Logger from "../loaders/logger";

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResult {
  userId: number;
  username: string;
  nickname: string;
  avatar: string | null;
  roles: string[];
  permissions: string[];
  accessToken: string;
  refreshToken: string;
  expires: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expires: string;
}

/**
 * 执行登录校验
 * 失败时抛出 AppError，成功时返回 Token 结果
 */
export async function login(
  input: LoginInput,
  clientInfo: { ip?: string; userAgent?: string }
): Promise<LoginResult> {
  const user = await findUserByLoginName(input.username);

  if (!user) {
    await recordLoginLog(null, input.username, 0, "账号不存在", clientInfo);
    throw new AppError("INVALID_CREDENTIALS", "用户名或密码错误");
  }

  if (user.status === 0) {
    await recordLoginLog(user.id, input.username, 0, "账号已停用", clientInfo);
    throw new AppError("USER_DISABLED", "账号已停用，请联系管理员");
  }

  if (!verifyPassword(input.password, user.password_hash)) {
    await recordLoginLog(user.id, input.username, 0, "密码错误", clientInfo);
    throw new AppError("INVALID_CREDENTIALS", "用户名或密码错误");
  }

  await updateLastLoginAt(user.id);
  await recordLoginLog(user.id, input.username, 1, undefined, clientInfo);

  return buildLoginResult(user);
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

async function buildLoginResult(user: UserRow): Promise<LoginResult> {
  const roles = await getUserRoles(user.id);
  const tokenResult = buildTokenResult(user.id, user.login_name);

  return {
    userId: user.id,
    username: user.login_name,
    nickname: user.display_name,
    avatar: user.avatar_url,
    roles: roles.map((r) => r.roleCode),
    permissions: [],
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    expires: tokenResult.expires,
  };
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

async function recordLoginLog(
  userId: number | null,
  loginName: string,
  loginResult: 0 | 1,
  failureReason?: string,
  clientInfo: { ip?: string; userAgent?: string } = {}
): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO login_logs
       (user_id, login_name, login_ip, user_agent, login_result, failure_reason, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        userId,
        loginName,
        clientInfo.ip ?? null,
        clientInfo.userAgent ?? null,
        loginResult,
        failureReason ?? null,
      ]
    );
  } catch (err) {
    Logger.error("记录登录日志失败: %o", err);
  }
}
