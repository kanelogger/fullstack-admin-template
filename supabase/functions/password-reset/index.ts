import { createClient } from "@supabase/supabase-js";
import { jsonResponse, handlePreflight } from "../_shared/http.ts";
import { PasswordResetRequestSchema } from "../_shared/contracts.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase Edge Function environment is incomplete");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const appOrigin = Deno.env.get("APP_ORIGIN") ?? "http://127.0.0.1:8848";

function acceptedResponse(request: Request): Response {
  return jsonResponse(request, 200, {
    success: true,
    data: { message: "如果账号有效且邮箱已验证，系统会发送重置链接" }
  });
}

Deno.serve(async request => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return jsonResponse(request, 405, {
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "仅支持 POST 请求" }
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, 400, {
      success: false,
      error: { code: "BAD_REQUEST", message: "请求内容格式无效" }
    });
  }

  const parsed = PasswordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(request, 400, {
      success: false,
      error: { code: "BAD_REQUEST", message: "请输入有效账号" }
    });
  }

  const { data: identity, error: lookupError } = await adminClient.rpc(
    "resolve_login_identity",
    { p_login_name: parsed.data.loginName }
  );

  if (!lookupError && identity?.email) {
    const { data: marked, error: markerError } = await adminClient.rpc(
      "mark_password_reset_requested",
      { p_auth_user_id: identity.authUserId }
    );
    if (markerError || marked !== true) {
      console.error("password reset request marker failed", markerError?.code);
    } else {
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
        identity.email,
        { redirectTo: `${appOrigin}/#/reset-password` }
      );
      if (resetError) {
        console.error("password reset delivery failed", resetError.status, resetError.code);
      }
    }
  } else if (lookupError) {
    console.error("password reset identity lookup failed", lookupError.code);
  }

  // Keep the response identical for unknown and known login names.
  return acceptedResponse(request);
});
