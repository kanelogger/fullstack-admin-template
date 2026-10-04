import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const frontendRoot = process.cwd();
const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");
const resetFixtureSuffix = randomUUID().slice(0, 8);
const fixtureUsers = [
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

function runSupabase(args, options = {}) {
  return spawnSync(supabaseCli, ["--workdir", "..", ...args], {
    cwd: frontendRoot,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "ignore"]
  });
}

function getLocalAdminClient() {
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
    !/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url) ||
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

async function ensureFixtures(admin) {
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
}

async function cleanupAuditLogFixtures(admin) {
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

async function ensureMessageFixtures(admin) {
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

async function cleanupFixtures(admin) {
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
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function tokenAuthMethods(accessToken) {
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

function tokenHasAuthMethod(accessToken, method) {
  return tokenAuthMethods(accessToken).includes(method);
}

async function startEdgeFunctions(url, publishableKey) {
  const edgeServer = spawn(
    supabaseCli,
    ["--workdir", "..", "functions", "serve", "--no-verify-jwt"],
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

async function loginFixtureWithAccountPassword(url, publishableKey, fixture) {
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

async function invokeUserManagement(url, publishableKey, accessToken, body) {
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

async function mailpitMessagesFor(email) {
  const response = await fetch("http://127.0.0.1:54324/api/v1/messages?start=0&limit=100");
  if (!response.ok) return [];
  const mailbox = await response.json();
  return (mailbox.messages ?? []).filter(message =>
    message.ID && message.To?.some(recipient =>
      recipient.Address?.toLowerCase() === email.toLowerCase()
    )
  );
}

async function waitForMailpitMessages(email, minimumCount) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const messages = await mailpitMessagesFor(email);
    if (messages.length >= minimumCount) return messages;
    await delay(500);
  }
  throw new Error(`Local Mailpit did not capture ${minimumCount} message(s) for the managed user`);
}

async function testManagedUserAdministration(url, publishableKey, admin) {
  const superAdmin = fixtureUsers.find(user => user.roleCode === "SUPER_ADMIN");
  const operator = fixtureUsers.find(user => user.roleCode === "OPERATOR");
  const commonUser = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!superAdmin || !operator || !commonUser) {
    throw new Error("User-management role fixtures are missing");
  }

  const loginSuffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const managedLoginName = `__codex_managed_${loginSuffix}`;
  const managedEmail = `__codex_managed_${loginSuffix}@example.test`;
  const managedUserCode = `__CODEX_${loginSuffix.toUpperCase()}`;
  let authUserId;
  let capturedMessageIds = [];

  try {
    const superAccessToken = await loginFixtureWithAccountPassword(
      url,
      publishableKey,
      superAdmin
    );
    const roleOptionsResult = await invokeUserManagement(
      url,
      publishableKey,
      superAccessToken,
      { action: "roles" }
    );
    const commonRole = roleOptionsResult.body?.data?.find(role => role.code === "COMMON_USER");
    if (
      roleOptionsResult.response.status !== 200 ||
      typeof commonRole?.id !== "string"
    ) {
      throw new Error("SUPER_ADMIN could not load role options for user creation");
    }

    const createdResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "create",
      input: {
        userCode: managedUserCode,
        loginName: managedLoginName,
        displayName: "Disposable managed user",
        email: managedEmail,
        phone: null,
        departmentId: null,
        postId: null,
        roleIds: [commonRole.id]
      }
    });
    const createdUser = createdResult.body?.data?.user;
    if (
      createdResult.response.status !== 200 ||
      createdResult.body?.success !== true ||
      createdUser?.loginName !== managedLoginName ||
      createdUser?.roles?.[0]?.code !== "COMMON_USER" ||
      createdUser?.isActive !== true
    ) {
      throw new Error("SUPER_ADMIN could not create a managed Auth/profile/role account");
    }
    authUserId = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }))
      .data?.users?.find(user => user.email?.toLowerCase() === managedEmail.toLowerCase())?.id;
    if (!authUserId) throw new Error("The created managed Auth user could not be found");
    capturedMessageIds = (await waitForMailpitMessages(managedEmail, 1)).map(mail => mail.ID);

    const { data: departmentOptions, error: departmentOptionsError } = await admin
      .from("department_read_model")
      .select("id")
      .eq("status", 1)
      .limit(1);
    const { data: postOptions, error: postOptionsError } = await admin
      .from("post_read_model")
      .select("id")
      .eq("status", 1)
      .limit(1);
    const departmentId = departmentOptions?.[0]?.id;
    const postId = postOptions?.[0]?.id;
    if (
      departmentOptionsError || postOptionsError ||
      typeof departmentId !== "string" || typeof postId !== "string"
    ) {
      throw new Error("The imported department/post rows could not be read as exact text IDs");
    }
    const updatedResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "update",
      input: {
        id: createdUser.id,
        userCode: `${managedUserCode}_EDIT`,
        loginName: managedLoginName,
        displayName: "Updated managed user",
        phone: "555-0100",
        departmentId,
        postId,
        roleIds: [commonRole.id]
      }
    });
    if (
      updatedResult.response.status !== 200 ||
      updatedResult.body?.data?.user?.departmentId !== departmentId ||
      updatedResult.body?.data?.user?.postId !== postId ||
      updatedResult.body?.data?.user?.displayName !== "Updated managed user"
    ) {
      throw new Error("User update did not preserve profile fields and BIGINT relation IDs");
    }

    const filteredResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "list",
      query: { loginName: managedLoginName, departmentId, postId, page: 1, pageSize: 10 }
    });
    if (
      filteredResult.response.status !== 200 ||
      filteredResult.body?.data?.total !== 1 ||
      filteredResult.body?.data?.items?.[0]?.id !== createdUser.id
    ) {
      throw new Error("User list filters did not match the created profile");
    }

    const disabledResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "status",
      id: createdUser.id,
      isActive: false
    });
    if (disabledResult.response.status !== 200 || disabledResult.body?.data?.user?.isActive !== false) {
      throw new Error("User status update did not disable the account");
    }

    const enabledResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "status",
      id: createdUser.id,
      isActive: true
    });
    if (enabledResult.response.status !== 200 || enabledResult.body?.data?.user?.isActive !== true) {
      throw new Error("User status update did not enable the account");
    }

    const { data: commonProfile, error: commonProfileError } = await admin
      .from("profiles")
      .select("id")
      .eq("login_name", commonUser.loginName)
      .single();
    if (commonProfileError || !commonProfile) {
      throw new Error("Could not find the reset-password permission fixture");
    }
    const resetResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "reset-password",
      id: String(commonProfile.id)
    });
    if (resetResult.response.status !== 200 || resetResult.body?.success !== true) {
      throw new Error("SUPER_ADMIN could not request a managed user's password reset");
    }
    const resetFixtureMessages = await waitForMailpitMessages(commonUser.email, 1);
    capturedMessageIds = [
      ...capturedMessageIds,
      ...resetFixtureMessages.map(mail => mail.ID)
    ];

    const operatorAccessToken = await loginFixtureWithAccountPassword(
      url,
      publishableKey,
      operator
    );
    const deniedList = await invokeUserManagement(url, publishableKey, operatorAccessToken, {
      action: "list",
      query: { page: 1, pageSize: 10 }
    });
    if (deniedList.response.status !== 403) {
      throw new Error("OPERATOR without user-read permission accessed managed users");
    }

    const deletedResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "delete",
      id: createdUser.id
    });
    if (deletedResult.response.status !== 200 || deletedResult.body?.data?.deleted !== true) {
      throw new Error("Managed user soft-delete failed");
    }
    const deletedList = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "list",
      query: { loginName: managedLoginName, page: 1, pageSize: 10 }
    });
    if (deletedList.response.status !== 200 || deletedList.body?.data?.total !== 0) {
      throw new Error("Soft-deleted user remained visible in the managed-user list");
    }

    const { data: createAudit, error: createAuditError } = await admin
      .from("operation_logs")
      .select("operator_id, module_code, operation_type, request_path, request_params")
      .eq("operator_id", superAdmin.id)
      .eq("module_code", "USER")
      .eq("operation_type", "CREATE")
      .eq("request_path", "/functions/v1/user-management")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      createAuditError ||
      createAudit?.request_params?.targetUserId !== createdUser.id ||
      JSON.stringify(createAudit?.request_params ?? {}).includes("password")
    ) {
      throw new Error("Managed-user mutations were not safely recorded in Supabase operation logs");
    }
    console.log("Managed user create/update/status/reset/delete and permission checks passed");
  } finally {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("login_name", managedLoginName);
    if (profiles?.length) {
      await admin.from("profiles").delete().in("id", profiles.map(profile => profile.id));
      authUserId ??= profiles[0].auth_user_id;
    }
    if (!authUserId) {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      authUserId = data.users.find(
        user => user.email?.toLowerCase() === managedEmail.toLowerCase()
      )?.id;
    }
    if (authUserId) await admin.auth.admin.deleteUser(authUserId);
    capturedMessageIds = [
      ...new Set([
        ...capturedMessageIds,
        ...(await mailpitMessagesFor(managedEmail)).map(mail => mail.ID),
        ...(await mailpitMessagesFor(commonUser.email)).map(mail => mail.ID)
      ])
    ];
    if (capturedMessageIds.length) {
      await fetch("http://127.0.0.1:54324/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: capturedMessageIds })
      });
    }
  }
}

async function testForcedResetEmail(url, publishableKey, admin) {
  const resetFixture = fixtureUsers.find(user => user.mustResetPassword);
  if (!resetFixture) throw new Error("Forced-reset fixture is missing");

  const edgeServer = await startEdgeFunctions(url, publishableKey);
  const capturedMessageIds = [];
  try {
    const response = await fetch(`${url}/functions/v1/password-reset`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: "http://localhost:8848"
      },
      body: JSON.stringify({ loginName: resetFixture.loginName })
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 200 || body?.success !== true) {
      throw new Error(
        `Password-reset request returned HTTP ${response.status} code ${body?.error?.code ?? "unknown"}`
      );
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const mailpitResponse = await fetch(
        "http://127.0.0.1:54324/api/v1/messages?start=0&limit=50"
      );
      if (mailpitResponse.ok) {
        const mailbox = await mailpitResponse.json();
        for (const message of mailbox.messages ?? []) {
          if (
            message.To?.some(recipient =>
              recipient.Address?.toLowerCase() === resetFixture.email.toLowerCase()
            ) && message.ID
          ) {
            capturedMessageIds.push(message.ID);
          }
        }
        if (capturedMessageIds.length) {
          break;
        }
      }
      await delay(500);
    }

    if (!capturedMessageIds.length) {
      throw new Error("Local Mailpit did not capture the forced-reset message");
    }

    await testPasswordRecoveryMethod(url, publishableKey, admin, resetFixture);
    await testManagedUserAdministration(url, publishableKey, admin);
    await testPasswordLoginMethod(url, publishableKey, admin);
    console.log(`Forced-reset email captured by local Mailpit (${capturedMessageIds.length})`);
  } finally {
    if (capturedMessageIds.length) {
      await fetch("http://127.0.0.1:54324/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: capturedMessageIds })
      });
    }
    edgeServer.kill("SIGINT");
    await new Promise(resolveExit => {
      if (edgeServer.exitCode !== null) return resolveExit();
      edgeServer.once("exit", () => resolveExit());
    });
  }
}

async function testLegacyMessageImport(admin) {
  const receiver = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!receiver) throw new Error("Message import recipient fixture is missing");

  const importedId = "9007199254740993";
  const sequenceTitle = `__codex_sequence_${randomUUID()}`;
  const legacyMessage = {
    id: importedId,
    receiver_id: receiver.id,
    sender_id: null,
    title: `__codex_import_${randomUUID()}`,
    summary: null,
    content: "",
    message_type: "CUSTOM_NOTICE",
    read_status: true,
    sent_at: "2026-10-01T10:00:00.000Z",
    read_at: null,
    created_by: null,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_by: null,
    updated_at: "2026-10-01T10:00:00.000Z",
    deleted: false
  };

  try {
    const { data: preview, error: previewError } = await admin.rpc(
      "import_legacy_messages",
      { p_rows: [legacyMessage], p_apply: false }
    );
    if (
      previewError ||
      preview?.sourceCount !== 1 ||
      preview?.rowsToInsert !== 1 ||
      preview?.insertedCount !== 0
    ) {
      throw new Error("Legacy message import preview returned an invalid result");
    }
    const { data: notInserted, error: previewReadError } = await admin
      .from("messages")
      .select("id")
      .eq("id", importedId)
      .maybeSingle();
    if (previewReadError || notInserted) {
      throw new Error("Legacy message import preview modified the target database");
    }

    const { data: applied, error: applyError } = await admin.rpc(
      "import_legacy_messages",
      { p_rows: [legacyMessage], p_apply: true }
    );
    if (applyError || applied?.insertedCount !== 1) {
      throw new Error("Legacy message import did not insert the validated row");
    }
    const { data: imported, error: importReadError } = await admin
      .from("message_read_model")
      .select("id, message_type, read_status, read_at, content")
      .eq("id", importedId)
      .single();
    if (
      importReadError ||
      imported?.id !== importedId ||
      imported?.message_type !== legacyMessage.message_type ||
      imported?.read_status !== true ||
      imported?.read_at !== null ||
      imported?.content !== ""
    ) {
      throw new Error("Legacy message import did not preserve source values");
    }

    const { data: retried, error: retryError } = await admin.rpc(
      "import_legacy_messages",
      { p_rows: [legacyMessage], p_apply: true }
    );
    if (
      retryError ||
      retried?.alreadyPresentCount !== 1 ||
      retried?.insertedCount !== 0
    ) {
      throw new Error("Legacy message import is not idempotent");
    }

    const conflictingMessage = { ...legacyMessage, title: "conflicting duplicate" };
    const { error: conflictError } = await admin.rpc("import_legacy_messages", {
      p_rows: [conflictingMessage],
      p_apply: false
    });
    if (!conflictError) {
      throw new Error("Legacy message import accepted a conflicting ID");
    }

    const { error: sequenceInsertError } = await admin.from("messages").insert({
      receiver_id: receiver.id,
      title: sequenceTitle,
      summary: null,
      content: "sequence probe",
      message_type: "NOTICE"
    });
    if (sequenceInsertError) throw new Error("Could not verify the imported identity sequence");
    const { data: sequenceProbe, error: sequenceReadError } = await admin
      .from("message_read_model")
      .select("id")
      .eq("receiver_id", receiver.id)
      .eq("title", sequenceTitle)
      .single();
    if (
      sequenceReadError ||
      !sequenceProbe ||
      BigInt(sequenceProbe.id) <= BigInt(importedId)
    ) {
      throw new Error("Legacy message import did not advance the identity sequence");
    }
    console.log("Legacy message import preview/apply/idempotency checks passed");
  } finally {
    await admin.from("messages").delete().eq("id", importedId);
    await admin.from("messages").delete().eq("title", sequenceTitle);
  }
}

async function createAccountPasswordClient(url, publishableKey, fixture) {
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

async function testAttachmentStorageAccess(url, publishableKey, admin) {
  const superAdmin = fixtureUsers.find(user => user.roleCode === "SUPER_ADMIN");
  const operator = fixtureUsers.find(user => user.roleCode === "OPERATOR");
  const commonUser = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!superAdmin || !operator || !commonUser) {
    throw new Error("Attachment role fixtures are missing");
  }

  const edgeServer = await startEdgeFunctions(url, publishableKey);
  const clients = [];
  let storagePath = null;
  let attachmentId = null;
  let legacyStoragePath = null;
  const metadataIds = new Set();
  try {
    const owner = await createAccountPasswordClient(url, publishableKey, superAdmin);
    clients.push(owner);
    const { data: successfulLoginAudit, error: successfulLoginAuditError } = await admin
      .from("login_logs")
      .select("user_id, login_result, failure_reason")
      .eq("login_name", superAdmin.loginName)
      .eq("user_id", superAdmin.id)
      .eq("login_result", 1)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (successfulLoginAuditError || successfulLoginAudit?.login_result !== 1) {
      throw new Error("Successful account/password login was not recorded in Supabase login logs");
    }

    const failedLoginResponse = await fetch(`${url}/functions/v1/session-login`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: "http://localhost:8848"
      },
      body: JSON.stringify({ loginName: superAdmin.loginName, password: "not-the-fixture-password" })
    });
    if (failedLoginResponse.status !== 401) {
      throw new Error("Invalid account/password login was unexpectedly accepted");
    }
    const { data: failedLoginAudit, error: failedLoginAuditError } = await admin
      .from("login_logs")
      .select("login_result, failure_reason")
      .eq("login_name", superAdmin.loginName)
      .eq("login_result", 0)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      failedLoginAuditError ||
      failedLoginAudit?.login_result !== 0 ||
      failedLoginAudit?.failure_reason !== "INVALID_CREDENTIALS"
    ) {
      throw new Error("Invalid account/password attempt was not recorded safely");
    }

    const bytes = Buffer.from("private attachment RLS check", "utf8");
    storagePath = `${superAdmin.id}/${randomUUID()}.txt`;
    const { error: uploadError } = await owner.storage
      .from("admin-attachments")
      .upload(storagePath, new Blob([bytes], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: false
      });
    if (uploadError) throw new Error("SUPER_ADMIN could not upload to private Storage");

    const { data: created, error: metadataError } = await owner.rpc(
      "create_attachment_metadata",
      {
        p_original_name: "__codex_private_attachment.txt",
        p_storage_path: storagePath,
        p_mime_type: "text/plain",
        p_file_ext: "txt",
        p_file_size: bytes.length,
        p_business_module: null,
        p_business_record_id: null
      }
    );
    if (metadataError || !created?.id) {
      throw new Error("SUPER_ADMIN could not create metadata for a private object");
    }
    attachmentId = String(created.id);

    const { data: ownerMetadata, error: ownerReadError } = await owner
      .from("attachment_read_model")
      .select("id")
      .eq("id", attachmentId)
      .single();
    if (ownerReadError || ownerMetadata?.id !== attachmentId) {
      throw new Error(`SUPER_ADMIN could not read the new attachment metadata (${ownerReadError?.code ?? "id-mismatch"})`);
    }

    const operatorClient = await createAccountPasswordClient(url, publishableKey, operator);
    clients.push(operatorClient);
    const { data: operatorMetadata, error: operatorReadError } = await operatorClient
      .from("attachment_read_model")
      .select("id")
      .eq("id", attachmentId)
      .single();
    if (operatorReadError || operatorMetadata?.id !== attachmentId) {
      throw new Error("OPERATOR could not read an authorized attachment");
    }
    const { data: operatorFile, error: operatorDownloadError } = await operatorClient
      .storage.from("admin-attachments").download(storagePath);
    if (operatorDownloadError || !operatorFile || Buffer.from(await operatorFile.arrayBuffer()).compare(bytes) !== 0) {
      throw new Error("OPERATOR could not read the authorized private object");
    }

    const operatorUploadPath = `${operator.id}/${randomUUID()}.txt`;
    const { error: deniedUploadError } = await operatorClient.storage
      .from("admin-attachments")
      .upload(operatorUploadPath, new Blob([bytes], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: false
      });
    if (!deniedUploadError) throw new Error("OPERATOR uploaded without the upload permission");

    const { data: deniedDeleteData, error: deniedDeleteError } = await operatorClient.storage
      .from("admin-attachments")
      .remove([storagePath]);
    if (!deniedDeleteError && (deniedDeleteData?.length ?? 0) > 0) {
      throw new Error("OPERATOR deleted an attachment without the delete permission");
    }
    const { data: stillReadable, error: stillReadableError } = await operatorClient.storage
      .from("admin-attachments").download(storagePath);
    if (stillReadableError || !stillReadable) {
      throw new Error("A denied OPERATOR delete removed the private object");
    }

    const commonClient = await createAccountPasswordClient(url, publishableKey, commonUser);
    clients.push(commonClient);
    const { data: commonMetadata, error: commonReadError } = await commonClient
      .from("attachment_read_model")
      .select("id")
      .eq("id", attachmentId);
    if (commonReadError || commonMetadata?.length !== 0) {
      throw new Error("COMMON_USER read an attachment outside its allowed module scope");
    }
    const { data: commonFile, error: commonDownloadError } = await commonClient
      .storage.from("admin-attachments").download(storagePath);
    if (!commonDownloadError || commonFile) {
      throw new Error("COMMON_USER downloaded an attachment without module permission");
    }

    const { data: deletePath, error: pathError } = await owner.rpc(
      "attachment_storage_path_for_delete",
      { p_attachment_id: attachmentId }
    );
    if (pathError || deletePath !== storagePath) {
      throw new Error("SUPER_ADMIN could not resolve the private object for deletion");
    }
    const { error: removeError } = await owner.storage
      .from("admin-attachments").remove([storagePath]);
    if (removeError) throw new Error("SUPER_ADMIN could not delete the private object");
    const { data: deleted, error: deleteError } = await owner.rpc(
      "delete_attachment_metadata",
      { p_attachment_id: attachmentId }
    );
    if (deleteError || deleted !== true) {
      throw new Error("SUPER_ADMIN could not soft-delete attachment metadata");
    }

    const legacyId = "9007199254740997";
    const legacyBytes = Buffer.from("imported private attachment", "utf8");
    legacyStoragePath = `legacy/${legacyId}/${randomUUID()}.txt`;
    const { error: legacyUploadError } = await admin.storage
      .from("admin-attachments")
      .upload(legacyStoragePath, new Blob([legacyBytes], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: false
      });
    if (legacyUploadError) throw new Error("Service role could not stage a legacy private object");

    const legacyRow = {
      id: legacyId,
      original_name: "__codex_imported_attachment.txt",
      storage_path: legacyStoragePath,
      mime_type: "text/plain",
      file_ext: "txt",
      file_size: String(legacyBytes.length),
      business_module: "PROJECT",
      business_record_id: null,
      reference_status: "1",
      upload_user_id: superAdmin.id,
      uploaded_at: "2026-10-02T10:00:00.000Z",
      created_by: null,
      created_at: "2026-10-02T09:00:00.000Z",
      updated_by: superAdmin.id,
      updated_at: "2026-10-02T10:00:00.000Z",
      deleted: false
    };
    const { data: importPreview, error: previewError } = await admin.rpc(
      "import_legacy_attachments",
      { p_rows: [legacyRow], p_apply: false }
    );
    if (
      previewError ||
      importPreview?.sourceCount !== 1 ||
      importPreview?.rowsToInsert !== 1 ||
      importPreview?.insertedCount !== 0
    ) {
      throw new Error("Legacy attachment preview returned an invalid result");
    }
    const { data: previewMetadata, error: previewReadError } = await admin
      .from("attachments").select("id").eq("id", legacyId).maybeSingle();
    if (previewReadError || previewMetadata) {
      throw new Error("Legacy attachment preview modified the target database");
    }

    const { data: importApply, error: importApplyError } = await admin.rpc(
      "import_legacy_attachments",
      { p_rows: [legacyRow], p_apply: true }
    );
    if (importApplyError || importApply?.insertedCount !== 1) {
      throw new Error("Legacy attachment import did not insert its metadata row");
    }
    metadataIds.add(legacyId);
    const { data: importedRow, error: importedReadError } = await admin
      .from("attachment_read_model")
      .select("id, business_module, business_record_id, reference_status, upload_user_id")
      .eq("id", legacyId)
      .single();
    if (
      importedReadError ||
      importedRow?.id !== legacyId ||
      importedRow?.business_module !== "PROJECT" ||
      importedRow?.business_record_id !== null ||
      importedRow?.reference_status !== 1 ||
      importedRow?.upload_user_id !== superAdmin.id
    ) {
      throw new Error("Legacy attachment metadata did not preserve its source fields");
    }

    const { data: retriedImport, error: retryError } = await admin.rpc(
      "import_legacy_attachments",
      { p_rows: [legacyRow], p_apply: true }
    );
    if (retryError || retriedImport?.alreadyPresentCount !== 1 || retriedImport?.insertedCount !== 0) {
      throw new Error("Legacy attachment import was not idempotent");
    }

    const { data: importedFile, error: importedDownloadError } = await operatorClient
      .storage.from("admin-attachments").download(legacyStoragePath);
    if (
      importedDownloadError ||
      !importedFile ||
      Buffer.from(await importedFile.arrayBuffer()).compare(legacyBytes) !== 0
    ) {
      throw new Error("OPERATOR could not read a migrated private object through Storage RLS");
    }

    console.log("Private Storage roles and legacy attachment import/idempotency passed");
  } finally {
    const paths = [storagePath, legacyStoragePath].filter(Boolean);
    if (paths.length) {
      await admin.storage.from("admin-attachments").remove(paths);
    }
    if (attachmentId) metadataIds.add(attachmentId);
    if (metadataIds.size) {
      const { error } = await admin.from("attachments").delete().in("id", [...metadataIds]);
      if (error) throw new Error("Could not clean the local attachment metadata fixture");
    }
    await Promise.all(clients.map(async client => {
      try {
        await client.rpc("revoke_account_password_session");
      } finally {
        await client.auth.signOut({ scope: "local" });
      }
    }));
    edgeServer.kill("SIGINT");
    await new Promise(resolveExit => {
      if (edgeServer.exitCode !== null) return resolveExit();
      edgeServer.once("exit", () => resolveExit());
    });
  }
}

async function testPasswordLoginMethod(url, publishableKey, admin) {
  const fixture = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!fixture?.password) throw new Error("Password login fixture is missing");

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
  const tokens = body?.data?.tokens;
  if (
    response.status !== 200 ||
    body?.success !== true ||
    typeof tokens?.accessToken !== "string" ||
    typeof tokens?.refreshToken !== "string" ||
    !tokenHasAuthMethod(tokens.accessToken, "password")
  ) {
    throw new Error("Account/password login did not produce a password-authenticated session");
  }

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  try {
    const { error: sessionError } = await client.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });
    if (sessionError) throw new Error("Could not initialize the local password session");

    const { data: profile, error: profileError } = await client.rpc("current_profile");
    if (profileError || profile?.loginName !== fixture.loginName) {
      throw new Error("Password-authenticated session could not read its own profile");
    }
    const { data: businessUserId, error: idError } = await client.rpc(
      "current_business_user_id"
    );
    if (idError || businessUserId !== fixture.id) {
      throw new Error("Password-authenticated session could not resolve its own business ID");
    }

    const { data: messages, error: listError, count: listCount } = await client
      .from("message_read_model")
      .select("id, receiver_id, title, summary, message_type, read_status, sent_at, read_at", {
        count: "exact"
      })
      .eq("receiver_id", fixture.id)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, 9);
    if (
      listError ||
      listCount !== 1 ||
      messages?.length !== 1 ||
      typeof messages[0].id !== "string" ||
      messages[0].read_status !== false
    ) {
      throw new Error("Recipient message list did not return its BIGINT-string inbox row");
    }

    const { count: unreadBefore, error: unreadError } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", fixture.id)
      .eq("read_status", false)
      .eq("deleted", false);
    if (unreadError || unreadBefore !== 1) {
      throw new Error("Recipient unread-message count did not match its inbox");
    }

    const { error: readError } = await client
      .from("messages")
      .update({ read_status: true, read_at: new Date().toISOString() })
      .eq("id", messages[0].id)
      .eq("receiver_id", fixture.id);
    if (readError) throw new Error("Recipient could not mark an inbox message as read");

    const { data: messageDetail, error: detailError } = await client
      .from("message_read_model")
      .select("id, receiver_id, sender_id, title, summary, content, message_type, read_status, sent_at, read_at")
      .eq("id", messages[0].id)
      .eq("receiver_id", fixture.id)
      .single();
    if (detailError || messageDetail?.read_status !== true) {
      throw new Error("Recipient could not read the updated inbox detail");
    }
    const { count: unreadAfter, error: unreadAfterError } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", fixture.id)
      .eq("read_status", false)
      .eq("deleted", false);
    if (unreadAfterError || unreadAfter !== 0) {
      throw new Error("Marking a message read did not update the unread count");
    }

    await testMessageRealtime(client, admin, fixture);
  } finally {
    await client.auth.signOut({ scope: "local" });
    await client.realtime.disconnect();
  }
}

async function waitUntil(predicate, failureMessage, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(typeof failureMessage === "function" ? failureMessage() : failureMessage);
}

async function testMessageRealtime(client, admin, fixture) {
  const title = `__codex_realtime_${randomUUID()}`;
  const otherTitle = `__codex_realtime_other_${randomUUID()}`;
  const otherRecipient = fixtureUsers.find(user => user.roleCode === "OPERATOR");
  if (!otherRecipient) throw new Error("Other-recipient Realtime fixture is missing");
  const observed = [];
  let subscriptionStatus = "CONNECTING";
  let subscriptionError;
  let replicationReady = false;
  let replicationError;
  const channel = client
    .channel(`test-inbox:${fixture.id}:${randomUUID()}`, {
      config: {
        broadcast: { replication_ready: true },
        postgres_changes_options: { wait: true }
      }
    })
    .on("system", {}, payload => {
      if (payload.extension !== "system") return;
      if (payload.status === "ok") replicationReady = true;
      else if (payload.status === "error") replicationError = payload.message;
    })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => observed.push({ event: "INSERT", payload })
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages"
      },
      payload => observed.push({ event: "UPDATE", payload })
    )
    .subscribe((status, error) => {
      subscriptionStatus = status;
      subscriptionError = error;
    });

  const messageIds = [];
  try {
    await waitUntil(
      () => (subscriptionStatus === "SUBSCRIBED" && replicationReady) || Boolean(subscriptionError || replicationError),
      "Realtime message subscription did not become ready"
    );
    if (subscriptionError || replicationError || subscriptionStatus !== "SUBSCRIBED" || !replicationReady) {
      throw new Error(
        `Could not subscribe to the recipient's message changes (status=${subscriptionStatus}, replicationReady=${replicationReady}, detail=${subscriptionError?.message ?? replicationError ?? "none"})`
      );
    }
    const { data: inserted, error: insertError } = await admin
      .from("messages")
      .insert({
        receiver_id: fixture.id,
        title,
        summary: "Realtime insert test",
        content: "A message should be delivered only to this recipient.",
        message_type: "NOTICE"
      })
      .select("title")
      .single();
    if (insertError || !inserted) throw new Error("Could not create a realtime message fixture");
    const { data: insertedReadModel, error: insertedReadModelError } = await admin
      .from("message_read_model")
      .select("id")
      .eq("receiver_id", fixture.id)
      .eq("title", title)
      .single();
    if (insertedReadModelError || !insertedReadModel) {
      throw new Error("Could not read the BIGINT-string Realtime fixture ID");
    }
    messageIds.push(insertedReadModel.id);

    await waitUntil(
      () => observed.some(item => item.event === "INSERT" && item.payload.new?.title === title),
      `Recipient did not receive the new-message Realtime event (status=${subscriptionStatus}, events=${observed.map(item => item.event).join(",") || "none"})`
    );

    const { data: otherInserted, error: otherInsertError } = await admin
      .from("messages")
      .insert({
        receiver_id: otherRecipient.id,
        title: otherTitle,
        summary: "Recipient isolation test",
        content: "This message belongs to a different user.",
        message_type: "NOTICE"
      })
      .select("title")
      .single();
    if (otherInsertError || !otherInserted) {
      throw new Error("Could not create a cross-recipient Realtime fixture");
    }
    const { data: otherReadModel, error: otherReadModelError } = await admin
      .from("message_read_model")
      .select("id")
      .eq("receiver_id", otherRecipient.id)
      .eq("title", otherTitle)
      .single();
    if (otherReadModelError || !otherReadModel) {
      throw new Error("Could not read the cross-recipient fixture ID");
    }
    messageIds.push(otherReadModel.id);
    await delay(1000);
    if (observed.some(item => item.payload.new?.title === otherTitle)) {
      throw new Error("Realtime delivered another recipient's message");
    }

    const { error: updateError } = await client
      .from("messages")
      .update({ read_status: true, read_at: new Date().toISOString() })
      .eq("id", messageIds[0])
      .eq("receiver_id", fixture.id);
    if (updateError) throw new Error("Recipient could not update its message read state");

    await waitUntil(
      () => observed.some(item =>
        item.event === "UPDATE" &&
        item.payload.new?.title === title &&
        item.payload.new?.read_status === true
      ),
      () => `Recipient did not receive the message read-state Realtime event (status=${subscriptionStatus}, events=${JSON.stringify(
        observed.map(item => ({
          event: item.event,
          id: String(item.payload.new?.id ?? ""),
          title: item.payload.new?.title,
          readStatus: item.payload.new?.read_status
        }))
      )})`
    );
  } finally {
    if (messageIds.length) {
      await admin.from("messages").delete().in("id", messageIds);
    }
    await client.removeChannel(channel);
  }
}

async function testPasswordRecoveryMethod(url, publishableKey, admin, fixture) {
  const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: fixture.email,
    options: { redirectTo: "http://127.0.0.1:8848/#/reset-password" }
  });
  const tokenHash = generated?.properties?.hashed_token;
  if (generateError || typeof tokenHash !== "string") {
    throw new Error("Could not generate a local password-recovery verification token");
  }

  const recoveryClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const nextPassword = `${randomUUID()}Bb2#`;
  try {
    const { data: verified, error: verifyError } = await recoveryClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery"
    });
    if (verifyError) {
      throw new Error(`Recovery token verification failed (${verifyError.code ?? "unknown"})`);
    }
    if (!verified.session) {
      throw new Error("Recovery token verification returned no session");
    }
    const recoveryMethods = tokenAuthMethods(verified.session.access_token);
    if (!recoveryMethods.some(method => method === "recovery" || method === "otp")) {
      throw new Error(`Recovery session methods were ${recoveryMethods.join(",") || "empty"}`);
    }

    const { data: profileResetState, error: resetStateError } = await admin
      .from("profiles")
      .select("password_reset_requested_at")
      .eq("id", fixture.id)
      .single();
    if (resetStateError || !profileResetState?.password_reset_requested_at) {
      throw new Error("The server did not record the password-reset request");
    }

    const { data: prematureCompletion, error: prematureError } = await recoveryClient.rpc(
      "complete_password_reset"
    );
    if (prematureError || prematureCompletion !== false) {
      throw new Error("Recovery session cleared the marker without changing the Auth password");
    }

    const { error: passwordError } = await recoveryClient.auth.updateUser({
      password: nextPassword
    });
    if (passwordError) throw new Error("Could not set a password through the recovery session");

    const { data: completed, error: completeError } = await recoveryClient.rpc(
      "complete_password_reset"
    );
    if (completeError || completed !== true) {
      throw new Error("Recovery session could not complete its scoped password-reset RPC");
    }
    const { data: completedProfile, error: completedProfileError } = await admin
      .from("profiles")
      .select("must_reset_password, password_reset_requested_at")
      .eq("id", fixture.id)
      .single();
    if (
      completedProfileError ||
      completedProfile.must_reset_password !== false ||
      completedProfile.password_reset_requested_at !== null
    ) {
      throw new Error("Password reset completion did not consume its server-side reset state");
    }
    const { data: recoveryProfile, error: profileError } = await recoveryClient.rpc(
      "current_profile"
    );
    if (profileError || recoveryProfile !== null) {
      throw new Error("Recovery session was incorrectly granted business profile access");
    }
    const { data: recoveryBusinessUserId, error: idError } = await recoveryClient.rpc(
      "current_business_user_id"
    );
    if (idError || recoveryBusinessUserId !== null) {
      throw new Error("Recovery session was incorrectly granted an application token identity");
    }
  } finally {
    await recoveryClient.auth.signOut({ scope: "local" });
  }

  const passwordClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  try {
    const { data: signedIn, error: signInError } = await passwordClient.auth.signInWithPassword({
      email: fixture.email,
      password: nextPassword
    });
    if (
      signInError ||
      !signedIn.session ||
      !tokenHasAuthMethod(signedIn.session.access_token, "password")
    ) {
      throw new Error("The reset password could not be used for password sign-in");
    }
    const { data: profile, error: profileError } = await passwordClient.rpc("current_profile");
    if (profileError || profile !== null) {
      throw new Error("Direct email/password Auth session bypassed account-login authorization");
    }
    const { data: directBusinessUserId, error: directIdError } = await passwordClient.rpc(
      "current_business_user_id"
    );
    if (directIdError || directBusinessUserId !== null) {
      throw new Error("Direct email/password Auth session obtained an application user ID");
    }
  } finally {
    await passwordClient.auth.signOut({ scope: "local" });
  }

  const loginResponse = await fetch(`${url}/functions/v1/session-login`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Origin: "http://localhost:8848"
    },
    body: JSON.stringify({ loginName: fixture.loginName, password: nextPassword })
  });
  const loginBody = await loginResponse.json().catch(() => null);
  if (loginResponse.status !== 200 || loginBody?.success !== true) {
    throw new Error("Account/password login did not accept the recovered password");
  }

  const accountClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  try {
    const { error: sessionError } = await accountClient.auth.setSession({
      access_token: loginBody.data.tokens.accessToken,
      refresh_token: loginBody.data.tokens.refreshToken
    });
    if (sessionError) throw new Error("Could not initialize the account/password session");
    const { data: profile, error: profileError } = await accountClient.rpc("current_profile");
    if (profileError || profile?.loginName !== fixture.loginName) {
      throw new Error("Account/password login could not read its own profile after recovery");
    }
  } finally {
    try {
      await accountClient.rpc("revoke_account_password_session");
    } catch {
      // Sign out locally even when revocation cannot reach the test database.
    }
    await accountClient.auth.signOut({ scope: "local" });
  }
}


let admin;
let localUrl;
let publishableKey;
let fixtureSetupStarted = false;
let exitCode = 0;

try {
  const local = getLocalAdminClient();
  admin = local.client;
  localUrl = local.url;
  publishableKey = local.publishableKey;
  fixtureSetupStarted = true;
  await ensureFixtures(admin);
  await ensureMessageFixtures(admin);

  const testRun = runSupabase(["test", "db", "--local"], { inherit: true });
  if (testRun.status !== 0) exitCode = testRun.status ?? 1;
  if (exitCode === 0) {
    await testForcedResetEmail(localUrl, publishableKey, admin);
    await testLegacyMessageImport(admin);
    await testAttachmentStorageAccess(localUrl, publishableKey, admin);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local database tests failed");
  exitCode = 1;
} finally {
  if (admin && fixtureSetupStarted) {
    try {
      await cleanupFixtures(admin);
      console.log("Local RLS fixtures cleaned");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Local RLS cleanup failed");
      exitCode = 1;
    }
  }
  if (admin) admin.realtime.disconnect();
}

process.exitCode = exitCode;
