import {
  ErrorEnvelopeSchema,
  LoginOutcomeSchema,
  LoginRequestSchema,
  PasswordResetCompletionRequestSchema,
  PasswordResetResponseSchema,
  SessionLoginResponseSchema,
  type AppError,
  type LoginOutcome,
  type PasswordResetResponse,
  type Session
} from "@/contracts";
import { getSupabaseClient } from "@/shared/supabase/client";
import { getCurrentSession } from "@/features/profile/profile.service";
import {
  beginAuthOperation,
  getAuthOperationRevision,
  isCurrentAuthOperation
} from "./session-generation";

function failure(code: string, message: string): LoginOutcome {
  return LoginOutcomeSchema.parse({
    success: false,
    error: { code, message }
  });
}

async function edgeFunctionError(error: unknown): Promise<AppError | null> {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return null;

  try {
    const parsed = ErrorEnvelopeSchema.safeParse(await context.clone().json());
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

async function discardAttemptSession(
  client: ReturnType<typeof getSupabaseClient>,
  expectedAccessToken: string
) {
  const { data } = await client.auth.getSession();
  if (data.session?.access_token === expectedAccessToken) {
    try {
      await client.rpc("revoke_account_password_session");
    } catch {
      // Clear the local session even when server-side revocation is unavailable.
    }
    await client.auth.signOut({ scope: "local" });
  }
}

export async function loginWithSupabase(
  input: unknown
): Promise<LoginOutcome> {
  const operationRevision = beginAuthOperation();
  const request = LoginRequestSchema.safeParse(input);
  if (!request.success) return failure("BAD_REQUEST", "账号或密码格式无效");

  const client = getSupabaseClient();
  const { data: edgeData, error: edgeError } = await client.functions.invoke(
    "session-login",
    { body: request.data }
  );

  if (edgeError) {
    const parsedError = await edgeFunctionError(edgeError);
    if (parsedError) {
      return LoginOutcomeSchema.parse({ success: false, error: parsedError });
    }
    throw edgeError;
  }

  const response = SessionLoginResponseSchema.safeParse(edgeData);
  if (!response.success) {
    throw new Error("登录服务返回了无效的 Session 契约");
  }
  if (response.data.success === false) return failure(
    response.data.error.code,
    response.data.error.message
  );

  if (!isCurrentAuthOperation(operationRevision)) {
    return failure("SESSION_CHANGED", "登录状态已变化，请重试");
  }

  const { data: sessionResult, error: sessionError } = await client.auth.setSession({
    access_token: response.data.data.tokens.accessToken,
    refresh_token: response.data.data.tokens.refreshToken
  });
  if (sessionError || !sessionResult.session) {
    return failure("SESSION_INIT_FAILED", "登录成功，但本地 Session 初始化失败，请重试");
  }
  const attemptAccessToken = sessionResult.session.access_token;
  if (sessionResult.session.user.id !== response.data.data.session.profile.authUserId) {
    await discardAttemptSession(client, attemptAccessToken);
    return failure("SESSION_MISMATCH", "登录会话与用户资料不匹配，请重试");
  }
  if (!isCurrentAuthOperation(operationRevision)) {
    await discardAttemptSession(client, attemptAccessToken);
    return failure("SESSION_CHANGED", "登录状态已变化，请重试");
  }

  return LoginOutcomeSchema.parse({
    success: true,
    data: response.data.data.session
  });
}

/** Restore the persisted Supabase session and its RLS-filtered application profile. */
export async function restoreSupabaseSession(): Promise<Session | null> {
  const operationRevision = getAuthOperationRevision();
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const initialSession = data.session;
  if (!initialSession) return null;

  const appSession = await getCurrentSession();
  const { data: latest, error: latestError } = await client.auth.getSession();
  if (latestError) throw latestError;
  if (
    !isCurrentAuthOperation(operationRevision) ||
    !latest.session ||
    latest.session.user.id !== initialSession.user.id ||
    appSession.profile.authUserId !== initialSession.user.id
  ) {
    return null;
  }
  return appSession;
}

export async function requestPasswordReset(
  input: unknown
): Promise<PasswordResetResponse> {
  const parsedInput = LoginRequestSchema.pick({ loginName: true }).safeParse(input);
  if (!parsedInput.success) {
    return PasswordResetResponseSchema.parse({
      success: false,
      error: { code: "BAD_REQUEST", message: "请输入有效账号" }
    });
  }

  const { data, error } = await getSupabaseClient().functions.invoke(
    "password-reset",
    { body: parsedInput.data }
  );
  if (error) {
    const parsedError = await edgeFunctionError(error);
    if (parsedError) {
      return PasswordResetResponseSchema.parse({ success: false, error: parsedError });
    }
    throw error;
  }

  return PasswordResetResponseSchema.parse(data);
}

export async function completePasswordReset(input: unknown): Promise<void> {
  const operationRevision = beginAuthOperation();
  const { password } = PasswordResetCompletionRequestSchema.parse(input);
  const client = getSupabaseClient();
  const { data: sessionResult, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionResult.session) {
    throw new Error("重置链接无效或已过期，请重新申请重置邮件");
  }

  const { error: updateError } = await client.auth.updateUser({ password });
  if (updateError) throw updateError;

  if (!isCurrentAuthOperation(operationRevision)) {
    throw new Error("登录状态已变化，请重新申请重置邮件");
  }

  const { data: completed, error: markerError } = await client.rpc(
    "complete_password_reset"
  );
  if (markerError || completed !== true) {
    throw markerError ?? new Error("无法完成账号重置状态更新");
  }

  const resetAccessToken = sessionResult.session.access_token;
  if (!isCurrentAuthOperation(operationRevision)) {
    await discardAttemptSession(client, resetAccessToken);
    throw new Error("登录状态已变化，请重新申请重置邮件");
  }
  await client.auth.signOut({ scope: "local" });
}
