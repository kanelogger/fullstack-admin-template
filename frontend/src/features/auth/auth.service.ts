import {
  ErrorEnvelopeSchema,
  LoginOutcomeSchema,
  LoginRequestSchema,
  PasswordResetCompletionRequestSchema,
  PasswordResetResponseSchema,
  SessionLoginResponseSchema,
  type AppError,
  type PasswordResetResponse,
  type Session
} from "@template/contracts";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentSession } from "@/features/profile/profile.service";
import { withAuthSessionLock } from "./auth-session-lock";
import { getAuthSessionIdentity, isSameAuthSession, type AuthSessionIdentity } from "./session-identity";
import {
  beginAuthOperation,
  completeAuthOperation,
  expectAuthSessionForOperation,
  getAuthOperationRevision,
  isCurrentAuthOperation
} from "./session-generation";

type FailedLogin = { success: false; error: AppError };
type SuccessfulLogin = {
  success: true;
  data: Session;
  authSessionId: string;
  discardIfStale: () => Promise<void>;
};
export type LoginWithSupabaseOutcome = FailedLogin | SuccessfulLogin;

function failure(code: string, message: string): FailedLogin {
  return LoginOutcomeSchema.parse({
    success: false,
    error: { code, message }
  }) as FailedLogin;
}

/** Revoke only the captured Session; never let Supabase JS substitute another tab's current token. */
export async function revokeSupabaseAuthSession(
  identity: AuthSessionIdentity,
  signal?: AbortSignal
): Promise<boolean> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return false;
  const response = await fetch(
    new URL("/rest/v1/rpc/revoke_account_password_session", supabaseUrl),
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${identity.accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}",
      signal
    }
  );
  if (!response.ok) return false;
  return await response.json().catch(() => false) === true;
}

function isRecoveryAccessToken(accessToken: string): boolean {
  try {
    const encodedPayload = accessToken.split(".")[1];
    if (!encodedPayload) return false;
    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return Array.isArray(claims.amr) && claims.amr.some(
      (entry: { method?: unknown }) => entry?.method === "recovery" || entry?.method === "otp"
    );
  } catch {
    return false;
  }
}

function recoveryTokensFromHash(hash: string) {
  const callbackSeparator = hash.indexOf("#", 1);
  if (
    callbackSeparator < 0 ||
    hash.slice(0, callbackSeparator).split("?")[0] !== "#/reset-password"
  ) return null;

  const parameters = new URLSearchParams(hash.slice(callbackSeparator + 1));
  if (parameters.get("type") !== "recovery" || parameters.get("token_type") !== "bearer") {
    return null;
  }
  const accessToken = parameters.get("access_token");
  const refreshToken = parameters.get("refresh_token");
  return accessToken && refreshToken && isRecoveryAccessToken(accessToken)
    ? { access_token: accessToken, refresh_token: refreshToken }
    : null;
}

/** Restore and validate a password-recovery-only Auth session from the SPA callback. */
export async function restorePasswordRecoverySession(hash: string): Promise<{
  available: boolean;
  scrubCallback: boolean;
}> {
  const client = getSupabaseClient();
  const callbackSession = recoveryTokensFromHash(hash);
  const { data, error } = await client.auth.getSession();
  if (!error && data.session && isRecoveryAccessToken(data.session.access_token)) {
    return { available: true, scrubCallback: Boolean(callbackSession) };
  }

  if (!callbackSession) return { available: false, scrubCallback: false };
  const restoredResult = await withAuthSessionLock(() => client.auth.setSession(callbackSession));
  const { data: restored, error: restoreError } = restoredResult;
  const validRecoverySession = !restoreError && Boolean(
    restored.session && isRecoveryAccessToken(restored.session.access_token)
  );
  return {
    available: validRecoverySession,
    scrubCallback: validRecoverySession
  };
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
  expectedAccessToken: string,
  expectedIdentity: AuthSessionIdentity | null
) {
  if (expectedIdentity) {
    try {
      await revokeSupabaseAuthSession(expectedIdentity);
    } catch {
      // Local cleanup is still safe when server-side revocation is unavailable.
    }
  }
  await withAuthSessionLock(async () => {
    const { data } = await client.auth.getSession();
    const currentIdentity = getAuthSessionIdentity(data.session);
    if (
      data.session?.access_token === expectedAccessToken ||
      isSameAuthSession(currentIdentity, expectedIdentity)
    ) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  });
}

export async function loginWithSupabase(
  input: unknown,
  operationRevision = beginAuthOperation()
): Promise<LoginWithSupabaseOutcome> {
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
      return { success: false, error: parsedError };
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
  const loginData = response.data.data;

  if (!isCurrentAuthOperation(operationRevision)) {
    return failure("SESSION_CHANGED", "登录状态已变化，请重试");
  }
  const requestedIdentity = getAuthSessionIdentity({
    access_token: loginData.tokens.accessToken,
    user: { id: loginData.session.profile.authUserId }
  });
  if (!requestedIdentity) return failure("SESSION_MISMATCH", "登录服务返回的 Session 无效，请重试");
  if (!expectAuthSessionForOperation(operationRevision, requestedIdentity)) {
    return failure("SESSION_CHANGED", "登录状态已变化，请重试");
  }

  const sessionResult = await withAuthSessionLock(async () => {
    if (!isCurrentAuthOperation(operationRevision)) return null;
    const { data, error } = await client.auth.setSession({
      access_token: loginData.tokens.accessToken,
      refresh_token: loginData.tokens.refreshToken
    });
    return { session: data.session, error };
  });
  if (!sessionResult) return failure("SESSION_CHANGED", "登录状态已变化，请重试");
  if (sessionResult.error || !sessionResult.session) {
    completeAuthOperation(operationRevision);
    console.warn(
      "Supabase Session initialization failed",
      sessionResult.error?.code ?? (sessionResult.session ? "UNKNOWN_AUTH_ERROR" : "SESSION_MISSING")
    );
    return failure("SESSION_INIT_FAILED", "登录成功，但本地 Session 初始化失败，请重试");
  }
  const authSession = sessionResult.session;
  const attemptAccessToken = authSession.access_token;
  const attemptIdentity = getAuthSessionIdentity(authSession);
  if (
    !attemptIdentity ||
    attemptIdentity.authUserId !== loginData.session.profile.authUserId
  ) {
    await discardAttemptSession(client, attemptAccessToken, attemptIdentity);
    completeAuthOperation(operationRevision);
    return failure("SESSION_MISMATCH", "登录会话与用户资料不匹配，请重试");
  }
  if (!isCurrentAuthOperation(operationRevision)) {
    await discardAttemptSession(client, attemptAccessToken, attemptIdentity);
    completeAuthOperation(operationRevision);
    return failure("SESSION_CHANGED", "登录状态已变化，请重试");
  }

  const validated = LoginOutcomeSchema.parse({ success: true, data: loginData.session });
  if ("error" in validated) return { success: false, error: validated.error };
  completeAuthOperation(operationRevision);
  let staleCleanupStarted = false;
  return {
    success: true,
    data: validated.data,
    authSessionId: attemptIdentity.sessionId,
    discardIfStale: async () => {
      if (staleCleanupStarted) return;
      staleCleanupStarted = true;
      await discardAttemptSession(client, attemptAccessToken, attemptIdentity);
    }
  };
}

/** Restore the persisted Supabase session and its RLS-filtered application profile. */
export async function restoreSupabaseSession(
  expectedIdentity?: Pick<AuthSessionIdentity, "authUserId" | "sessionId">
): Promise<Session | null> {
  const operationRevision = getAuthOperationRevision();
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const initialSession = data.session;
  if (!initialSession) return null;
  const initialIdentity = getAuthSessionIdentity(initialSession);
  if (!initialIdentity || (expectedIdentity && !isSameAuthSession(initialIdentity, expectedIdentity))) {
    return null;
  }

  const appSession = await getCurrentSession();
  const { data: latest, error: latestError } = await client.auth.getSession();
  if (latestError) throw latestError;
  if (
    !isCurrentAuthOperation(operationRevision) ||
    !latest.session ||
    !isSameAuthSession(getAuthSessionIdentity(latest.session), initialIdentity) ||
    appSession.profile.authUserId !== initialSession.user.id
  ) {
    return null;
  }
  return appSession;
}

/** Remove a rejected persisted Session only if that exact Session still owns local Auth storage. */
export async function clearRejectedSupabaseSessionIfCurrent(
  expectedIdentity: Pick<AuthSessionIdentity, "authUserId" | "sessionId">
): Promise<boolean> {
  const client = getSupabaseClient();
  return withAuthSessionLock(async () => {
    const { data } = await client.auth.getSession();
    if (!isSameAuthSession(getAuthSessionIdentity(data.session), expectedIdentity)) return false;

    const { error } = await client.auth.signOut({ scope: "local" });
    if (!error) return true;

    // Supabase removes a local Session for Auth 401/403 responses; confirm that
    // happened without clearing a Session installed by a newer login.
    const { data: latest, error: latestError } = await client.auth.getSession();
    return !latestError &&
      !isSameAuthSession(getAuthSessionIdentity(latest.session), expectedIdentity);
  });
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
  await withAuthSessionLock(async () => {
    const { data: sessionResult, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionResult.session) {
      throw new Error("重置链接无效或已过期，请重新申请重置邮件");
    }
    const resetIdentity = getAuthSessionIdentity(sessionResult.session);
    if (!resetIdentity) throw new Error("重置链接无效或已过期，请重新申请重置邮件");

    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) throw updateError;
    if (!isCurrentAuthOperation(operationRevision)) {
      throw new Error("登录状态已变化，请重新申请重置邮件");
    }

    const { data: completed, error: markerError } = await client.rpc("complete_password_reset");
    if (markerError || completed !== true) {
      throw markerError ?? new Error("无法完成账号重置状态更新");
    }
    const { data: latest } = await client.auth.getSession();
    if (
      !isCurrentAuthOperation(operationRevision) ||
      !isSameAuthSession(getAuthSessionIdentity(latest.session), resetIdentity)
    ) {
      throw new Error("登录状态已变化，请重新申请重置邮件");
    }
    await client.auth.signOut({ scope: "local" });
  });
}
