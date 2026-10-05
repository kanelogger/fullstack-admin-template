import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const frontendRoot = process.cwd();
export const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");
export const supabaseProjectRoot = resolve(process.env.SUPABASE_PROJECT_ROOT ?? resolve(frontendRoot, ".."));
export const mailpitUrl = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const resetFixtureSuffix = randomUUID().slice(0, 8);
const organizationFixtureSuffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
export const organizationFixtureCodes = {
  department: `__CODEX_${organizationFixtureSuffix}_DEPT`,
  post: `__CODEX_${organizationFixtureSuffix}_POST`
};
export const fixtureUsers = [
  {
    id: "910000000000001",
    loginName: "__codex_rls_common",
    email: "__codex_rls_common@example.test",
    displayName: "RLS Common",
    roleCode: "COMMON_USER"
  },
  {
    id: "910000000000002",
    loginName: "__codex_rls_operator",
    email: "__codex_rls_operator@example.test",
    displayName: "RLS Operator",
    roleCode: "OPERATOR"
  },
  {
    id: "910000000000003",
    loginName: "__codex_rls_super",
    email: "__codex_rls_super@example.test",
    displayName: "RLS Super Admin",
    roleCode: "SUPER_ADMIN"
  },
  {
    id: "910000000000004",
    loginName: `__codex_rls_reset_${resetFixtureSuffix}`,
    email: `__codex_rls_reset_${resetFixtureSuffix}@example.test`,
    displayName: "RLS Password Reset",
    roleCode: "COMMON_USER",
    mustResetPassword: true
  }
];

export function runSupabase(args, options = {}) {
  return spawnSync(supabaseCli, ["--workdir", supabaseProjectRoot, ...args], {
    cwd: frontendRoot,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "ignore"]
  });
}

export function getLocalAdminClient() {
  const status = runSupabase(["status", "--output", "json"]);
  if (status.status !== 0) throw new Error("Supabase Local is not running");

  let values;
  try {
    values = JSON.parse(status.stdout);
  } catch {
    throw new Error("Supabase Local status did not return valid JSON");
  }

  const url = values.API_URL ?? values.api_url;
  const serviceRoleKey =
    values.SERVICE_ROLE_KEY ?? values.service_role_key ?? values.SECRET_KEY;
  if (
    typeof url !== "string" ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) ||
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey
  ) {
    throw new Error("Could not identify the local Supabase API and admin key");
  }

  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  if (typeof publishableKey !== "string" || !publishableKey) {
    throw new Error("Could not identify the local Supabase publishable key");
  }

  return {
    client: createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    }),
    url,
    publishableKey
  };
}

export async function ensureFixtures(admin) {
  const resetFixture = fixtureUsers.find(user => user.id === "910000000000004");
  if (resetFixture) {
    const { data: existingResetProfile, error: resetLookupError } = await admin
      .from("profiles")
      .select("login_name, email")
      .eq("id", resetFixture.id)
      .maybeSingle();
    if (resetLookupError) throw new Error("Could not inspect the local reset-account fixture");
    if (
      existingResetProfile?.login_name?.startsWith("__codex_rls_reset_") &&
      typeof existingResetProfile.email === "string"
    ) {
      resetFixture.loginName = existingResetProfile.login_name;
      resetFixture.email = existingResetProfile.email;
    }
  }
  await cleanupAuditLogFixtures(admin);
  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (listError) throw new Error("Could not inspect local Auth test fixtures");

  for (const fixture of fixtureUsers) {
    fixture.password = `${randomUUID()}Aa1!`;
    let authUser = listedUsers.users.find(
      user => user.email?.toLowerCase() === fixture.email.toLowerCase()
    );

    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: fixture.email,
        password: fixture.password,
        email_confirm: true
      });
      if (error || !data.user) throw new Error("Could not create local Auth test fixture");
      authUser = data.user;
    } else {
      const { error } = await admin.auth.admin.updateUserById(authUser.id, {
        password: fixture.password,
        email_confirm: true
      });
      if (error) throw new Error("Could not refresh the local Auth fixture password");
    }

    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();
    if (profileLookupError) throw new Error("Could not inspect local profile fixture");
    if (existingProfile && String(existingProfile.id) !== fixture.id) {
      throw new Error("Local profile fixture ID does not match the reserved test ID");
    }

    const profileInput = {
      id: fixture.id,
      auth_user_id: authUser.id,
      login_name: fixture.loginName,
      display_name: fixture.displayName,
      email: fixture.email,
      is_active: true,
      must_reset_password: fixture.mustResetPassword ?? false
    };

    const profileWrite = existingProfile
      ? await admin.from("profiles").update(profileInput).eq("auth_user_id", authUser.id)
      : await admin.from("profiles").insert(profileInput);
    if (profileWrite.error) {
      throw new Error(`Could not provision local profile fixture (${profileWrite.error.code ?? "unknown"})`);
    }

    const { data: role, error: roleError } = await admin
      .from("roles")
      .select("id")
      .eq("code", fixture.roleCode)
      .single();
    if (roleError || !role) throw new Error("Required seeded role is missing");

    const { error: assignmentError } = await admin
      .from("user_roles")
      .upsert({ user_id: fixture.id, role_id: role.id }, { onConflict: "user_id,role_id" });
    if (assignmentError) throw new Error("Could not provision local role fixture");

    if (!fixture.mustResetPassword) {
      fixture.sessionId ??= randomUUID();
      const { data: registered, error: registrationError } = await admin.rpc(
        "register_account_password_session",
        { p_session_id: fixture.sessionId, p_auth_user_id: authUser.id }
      );
      if (registrationError || registered !== true) {
        throw new Error("Could not provision the local authorized-session fixture");
      }
    }
  }

  const { data: operatorRole, error: operatorRoleError } = await admin
    .from("roles")
    .select("id")
    .eq("code", "OPERATOR")
    .single();
  if (operatorRoleError || !operatorRole) throw new Error("Seeded OPERATOR role is missing");
  const { data: operatorPermissions, error: operatorPermissionsError } = await admin
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", operatorRole.id);
  if (operatorPermissionsError || !operatorPermissions?.some(item => item.permission_key === "communication.messages.read")) {
    throw new Error("Seed must grant OPERATOR the message-center read permission");
  }
}

export async function cleanupAuditLogFixtures(admin) {
  const loginNames = [
    ...fixtureUsers.map(user => user.loginName),
    "__codex_edge_readiness__"
  ];
  const profileIds = fixtureUsers.map(user => user.id);
  const { error: loginByNameError } = await admin
    .from("login_logs")
    .delete()
    .in("login_name", loginNames);
  if (loginByNameError) throw new Error("Could not clean local login audit fixtures");

  const { error: loginByIdError } = await admin
    .from("login_logs")
    .delete()
    .in("user_id", profileIds);
  if (loginByIdError) throw new Error("Could not clean local login audit fixtures");

  const { error: operationError } = await admin
    .from("operation_logs")
    .delete()
    .in("operator_id", profileIds);
  if (operationError) throw new Error("Could not clean local operation audit fixtures");
}

export async function ensureMessageFixtures(admin) {
  const receiverIds = fixtureUsers.map(fixture => fixture.id);
  const { error: cleanupError } = await admin
    .from("messages")
    .delete()
    .in("receiver_id", receiverIds);
  if (cleanupError) throw new Error("Could not clean local message fixtures");

  const fixtures = fixtureUsers.map(fixture => ({
    receiver_id: fixture.id,
    title: `__codex_message_${fixture.loginName}`,
    summary: "Disposable local RLS fixture",
    content: "This message belongs only to its recipient.",
    message_type: "NOTICE",
    read_status: false
  }));
  const { error } = await admin.from("messages").insert(fixtures);
  if (error) throw new Error("Could not create local message fixtures");
}

export async function ensureOrganizationFixtures(admin) {
  const { error: departmentError } = await admin.from("departments").insert({
    dept_code: organizationFixtureCodes.department,
    dept_name: "Disposable department option",
    status: 1
  });
  if (departmentError) throw new Error("Could not provision local department options");

  const { error: postError } = await admin.from("posts").insert({
    post_code: organizationFixtureCodes.post,
    post_name: "Disposable post option",
    status: 1
  });
  if (postError) throw new Error("Could not provision local post options");
}

export async function cleanupFixtures(admin) {
  await cleanupAuditLogFixtures(admin);
  const loginNames = fixtureUsers.map(user => user.loginName);
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, auth_user_id")
    .in("login_name", loginNames);
  if (profileError) throw new Error("Could not find local profiles for cleanup");

  const profileIds = (profiles ?? []).map(profile => String(profile.id));
  if (profileIds.length) {
    const { error: messagesError } = await admin
      .from("messages")
      .delete()
      .in("receiver_id", profileIds);
    if (messagesError) throw new Error("Could not clean local message fixtures");

    const { error: rolesError } = await admin
      .from("user_roles")
      .delete()
      .in("user_id", profileIds);
    if (rolesError) throw new Error("Could not clean local role fixtures");

    const { error: deleteProfileError } = await admin
      .from("profiles")
      .delete()
      .in("id", profileIds);
    if (deleteProfileError) throw new Error("Could not clean local profile fixtures");
  }

  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (listError) throw new Error("Could not inspect local Auth fixtures for cleanup");

  for (const fixture of fixtureUsers) {
    const user = listedUsers.users.find(
      candidate => candidate.email?.toLowerCase() === fixture.email.toLowerCase()
    );
    if (user) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error("Could not delete local Auth test fixture");
    }
  }

  const { error: departmentError } = await admin.from("departments")
    .delete().eq("dept_code", organizationFixtureCodes.department);
  if (departmentError) throw new Error("Could not clean the local department option fixture");
  const { error: postError } = await admin.from("posts")
    .delete().eq("post_code", organizationFixtureCodes.post);
  if (postError) throw new Error("Could not clean the local post option fixture");
}

export function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

export function tokenAuthMethods(accessToken) {
  try {
    const encodedPayload = accessToken.split(".")[1];
    if (!encodedPayload) return [];
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return Array.isArray(claims.amr)
      ? claims.amr.flatMap(entry => typeof entry?.method === "string" ? [entry.method] : [])
      : [];
  } catch {
    return [];
  }
}

export function tokenHasAuthMethod(accessToken, method) {
  return tokenAuthMethods(accessToken).includes(method);
}

export async function startEdgeFunctions(url, publishableKey) {
  const edgeServer = spawn(
    supabaseCli,
    ["--workdir", supabaseProjectRoot, "functions", "serve", "--no-verify-jwt"],
    { cwd: frontendRoot, stdio: "inherit" }
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (edgeServer.exitCode !== null) {
      throw new Error("Supabase Edge Function runtime failed to start");
    }
    try {
      const loginResponse = await fetch(`${url}/functions/v1/session-login`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json",
          Origin: "http://localhost:8848"
        },
        body: JSON.stringify({
          loginName: "__codex_edge_readiness__",
          password: "not-a-real-test-password"
        })
      });
      const loginBody = await loginResponse.json().catch(() => null);

      // OPTIONS can succeed at the API gateway before the function module is
      // loaded. Probe both functions with an unknown account; the reset probe
      // is generic and must not send mail or reveal account existence.
      const resetResponse = await fetch(`${url}/functions/v1/password-reset`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json",
          Origin: "http://localhost:8848"
        },
        body: JSON.stringify({ loginName: "__codex_edge_readiness__" })
      });
      const resetBody = await resetResponse.json().catch(() => null);
      if (
        loginResponse.status === 401 &&
        loginBody?.error?.code === "INVALID_CREDENTIALS" &&
        resetResponse.status === 200 &&
        resetBody?.success === true
      ) {
        return edgeServer;
      }
    } catch {
      // The API gateway or function bundle may be ready before both probes pass.
    }
    await delay(500);
  }

  edgeServer.kill("SIGINT");
  throw new Error("Supabase Edge Function runtime did not become ready");
}

export async function loginFixtureWithAccountPassword(url, publishableKey, fixture) {
  if (!fixture.password) throw new Error("Password login fixture is missing");
  const response = await fetch(`${url}/functions/v1/session-login`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Origin: "http://localhost:8848"
    },
    body: JSON.stringify({ loginName: fixture.loginName, password: fixture.password })
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || body?.success !== true) {
    throw new Error(`Could not establish the ${fixture.roleCode} application session`);
  }
  return body.data.tokens.accessToken;
}

export async function invokeUserManagement(url, publishableKey, accessToken, body) {
  const response = await fetch(`${url}/functions/v1/user-management`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Origin: "http://localhost:8848"
    },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => null) };
}

export async function mailpitMessagesFor(email) {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?start=0&limit=100`);
  if (!response.ok) return [];
  const mailbox = await response.json();
  return (mailbox.messages ?? []).filter(message =>
    message.ID && message.To?.some(recipient =>
      recipient.Address?.toLowerCase() === email.toLowerCase()
    )
  );
}

export async function waitForMailpitMessages(email, minimumCount) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const messages = await mailpitMessagesFor(email);
    if (messages.length >= minimumCount) return messages;
    await delay(500);
  }
  throw new Error(`Local Mailpit did not capture ${minimumCount} message(s) for the managed user`);
}

export async function createAccountPasswordClient(url, publishableKey, fixture) {
  if (!fixture.password) throw new Error("Attachment Auth fixture password is missing");
  const response = await fetch(`${url}/functions/v1/session-login`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Origin: "http://localhost:8848"
    },
    body: JSON.stringify({ loginName: fixture.loginName, password: fixture.password })
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || body?.success !== true) {
    throw new Error(`Could not establish the ${fixture.roleCode} attachment test session`);
  }

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { error } = await client.auth.setSession({
    access_token: body.data.tokens.accessToken,
    refresh_token: body.data.tokens.refreshToken
  });
  if (error) throw new Error(`Could not initialize the ${fixture.roleCode} attachment session`);
  return client;
}
