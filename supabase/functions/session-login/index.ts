import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { jsonResponse, handlePreflight } from "../_shared/http.ts";
import { LoginIdentitySchema, LoginRequestSchema } from "../_shared/contracts.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase Edge Function environment is incomplete");
}

const publicClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const invalidCredentialsMessage =
  "账号或密码错误；如账号需要强制重置，请使用忘记密码申请邮件链接";

function errorResponse(request: Request, status: number, code: string, message: string) {
  return jsonResponse(request, status, { success: false, error: { code, message } });
}

async function recordLoginAttempt(
  request: Request,
  loginName: string,
  userId: string | null,
  success: boolean,
  failureReason: string | null
) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip")?.trim() || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
  const { error } = await adminClient.rpc("record_login_attempt", {
    p_login_name: loginName.slice(0, 64),
    p_user_id: userId,
    p_login_ip: ip?.slice(0, 64) ?? null,
    p_user_agent: userAgent,
    p_login_result: success ? 1 : 0,
    p_failure_reason: success ? null : (failureReason ?? "INVALID_CREDENTIALS").slice(0, 255)
  });
  if (error) console.error("login audit write failed", error.code);
}

async function recordServerException(request: Request, errorType: string, message: string) {
  const path = new URL(request.url).pathname;
  const { error } = await adminClient.rpc("record_exception_event", {
    p_request_path: path.slice(0, 255),
    p_request_method: request.method.slice(0, 16),
    p_error_type: errorType.slice(0, 128),
    p_error_message: message.slice(0, 3000),
    p_stack_summary: null
  });
  if (error) console.error("exception audit write failed", error.code);
}

function getPasswordSessionId(accessToken: string, expectedUserId: string): string | null {
  const encodedPayload = accessToken.split(".")[1];
  if (!encodedPayload) return null;

  try {
    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const payload = new TextDecoder().decode(
      Uint8Array.from(binary, character => character.charCodeAt(0))
    );
    const claims = JSON.parse(payload) as {
      sub?: unknown;
      session_id?: unknown;
      amr?: unknown;
    };
    const hasPasswordMethod = Array.isArray(claims.amr) && claims.amr.some(
      entry => entry !== null && typeof entry === "object" &&
        "method" in entry && entry.method === "password"
    );

    if (
      claims.sub !== expectedUserId ||
      typeof claims.session_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id) ||
      !hasPasswordMethod
    ) {
      return null;
    }

    return claims.session_id;
  } catch {
    return null;
  }
}

Deno.serve(async request => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return errorResponse(request, 405, "METHOD_NOT_ALLOWED", "仅支持 POST 请求");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(request, 400, "BAD_REQUEST", "请求内容格式无效");
  }

  const parsedBody = LoginRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return errorResponse(request, 400, "BAD_REQUEST", "账号或密码格式无效");
  }

  const { data: rawIdentity, error: lookupError } = await adminClient.rpc(
    "resolve_login_identity",
    { p_login_name: parsedBody.data.loginName }
  );
  if (lookupError) {
    await Promise.all([
      recordLoginAttempt(request, parsedBody.data.loginName, null, false, "LOGIN_SERVICE_UNAVAILABLE"),
      recordServerException(request, "LoginIdentityLookup", "Login identity lookup failed")
    ]);
    return errorResponse(request, 500, "INTERNAL_ERROR", "登录服务暂不可用");
  }

  const identityResult = LoginIdentitySchema.safeParse(rawIdentity);
  if (!identityResult.success) {
    await recordLoginAttempt(request, parsedBody.data.loginName, null, false, "INVALID_CREDENTIALS");
    return errorResponse(request, 401, "INVALID_CREDENTIALS", "账号或密码错误");
  }
  const identity = identityResult.data;

  if (identity.mustResetPassword) {
    await recordLoginAttempt(request, identity.loginName, identity.id, false, "PASSWORD_RESET_REQUIRED");
    return errorResponse(
      request,
      401,
      "INVALID_CREDENTIALS",
      invalidCredentialsMessage
    );
  }

  const { data: authResult, error: authError } = await publicClient.auth.signInWithPassword({
    email: identity.email,
    password: parsedBody.data.password
  });
  if (authError || !authResult.session || !authResult.user) {
    await recordLoginAttempt(request, identity.loginName, identity.id, false, "INVALID_CREDENTIALS");
    return errorResponse(request, 401, "INVALID_CREDENTIALS", invalidCredentialsMessage);
  }

  if (authResult.user.id !== identity.authUserId) {
    await recordLoginAttempt(request, identity.loginName, identity.id, false, "INVALID_CREDENTIALS");
    return errorResponse(request, 401, "INVALID_CREDENTIALS", invalidCredentialsMessage);
  }

  const sessionId = getPasswordSessionId(
    authResult.session.access_token,
    identity.authUserId
  );
  if (!sessionId) {
    await recordLoginAttempt(request, identity.loginName, identity.id, false, "INVALID_CREDENTIALS");
    return errorResponse(request, 401, "INVALID_CREDENTIALS", invalidCredentialsMessage);
  }

  const { data: sessionRegistered, error: sessionRegistrationError } =
    await adminClient.rpc("register_account_password_session", {
      p_session_id: sessionId,
      p_auth_user_id: identity.authUserId
    });
  if (sessionRegistrationError || sessionRegistered !== true) {
    console.error(
      "account/password session registration failed",
      sessionRegistrationError?.code
    );
    await Promise.all([
      recordLoginAttempt(request, identity.loginName, identity.id, false, "SESSION_REGISTRATION_FAILED"),
      recordServerException(request, "PasswordSessionRegistration", "Password session registration failed")
    ]);
    return errorResponse(request, 503, "INTERNAL_ERROR", "登录服务暂不可用");
  }

  await recordLoginAttempt(request, identity.loginName, identity.id, true, null);

  const expiresAt = authResult.session.expires_at ??
    Math.floor(Date.now() / 1000) + authResult.session.expires_in;

  return jsonResponse(request, 200, {
    success: true,
    data: {
      session: {
        profile: {
          id: identity.id,
          authUserId: identity.authUserId,
          loginName: identity.loginName,
          displayName: identity.displayName,
          email: identity.email,
          phone: identity.phone,
          avatarUrl: identity.avatarUrl,
          isActive: identity.isActive
        },
        roleCodes: identity.roleCodes,
        permissionKeys: identity.permissionKeys,
        mustResetPassword: false
      },
      tokens: {
        accessToken: authResult.session.access_token,
        refreshToken: authResult.session.refresh_token,
        expiresAt
      }
    }
  });
});
