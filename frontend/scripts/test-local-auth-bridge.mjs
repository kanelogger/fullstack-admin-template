import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(frontendRoot, "..");
const backendRoot = resolve(repositoryRoot, "backend");
const backendRequire = createRequire(resolve(backendRoot, "package.json"));
const dotenv = backendRequire("dotenv");
const fs = backendRequire("node:fs");
const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");
const mailpitUrl = "http://127.0.0.1:54324";
const fastifyUrl = "http://127.0.0.1:3000";
const localApiPattern = /^http:\/\/(127\.0\.0\.1|localhost):54321$/;
const localRedirectOrigin = "http://localhost:8848";

function runSupabase(args) {
  const result = backendRequire("node:child_process").spawnSync(
    supabaseCli,
    ["--workdir", "..", ...args],
    {
      cwd: frontendRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error("Supabase Local CLI request failed");
  }
  return result.stdout.trim();
}

function localCredentials() {
  let status;
  try {
    status = JSON.parse(runSupabase(["status", "--output", "json"]));
  } catch {
    throw new Error("Supabase Local is not available");
  }
  const url = status.API_URL ?? status.api_url;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  if (!localApiPattern.test(url ?? "") || !serviceRoleKey || !publishableKey) {
    throw new Error("This test only accepts the project's local Supabase keys");
  }
  return { url, serviceRoleKey, publishableKey };
}

function startEdgeFunctions() {
  const child = spawn(supabaseCli, ["--workdir", "..", "functions", "serve", "--no-verify-jwt"], {
    cwd: frontendRoot,
    stdio: "ignore",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  return child;
}

async function waitForEdgeFunctions(child, url, publishableKey) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Supabase Edge Functions did not start");
    try {
      const headers = {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: localRedirectOrigin
      };
      const loginResponse = await fetch(`${url}/functions/v1/session-login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ loginName: "__codex_edge_readiness__", password: "invalid-test-password" })
      });
      const loginBody = await loginResponse.json().catch(() => null);
      const resetResponse = await fetch(`${url}/functions/v1/password-reset`, {
        method: "POST",
        headers,
        body: JSON.stringify({ loginName: "__codex_edge_readiness__" })
      });
      const resetBody = await resetResponse.json().catch(() => null);
      if (
        loginResponse.status === 401 && loginBody?.error?.code === "INVALID_CREDENTIALS" &&
        resetResponse.status === 200 && resetBody?.success === true
      ) return;
    } catch {
      // The API gateway can become reachable before both function bundles load.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  throw new Error("Supabase Edge Functions did not become reachable");
}

async function mailpitMessagesFor(email) {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?start=0&limit=100`);
  if (!response.ok) throw new Error("Local Mailpit is not available");
  const mailbox = await response.json();
  return (mailbox.messages ?? []).filter(message =>
    message.ID && message.To?.some(recipient =>
      recipient.Address?.toLowerCase() === email.toLowerCase()
    )
  );
}

function findRecoveryToken(message) {
  const bodies = [message.Text, message.HTML].filter(value => typeof value === "string");
  for (const body of bodies) {
    const urls = [...body.matchAll(/https?:\/\/[^\s"<>]+/g)].map(match =>
      match[0].replaceAll("&amp;", "&")
    );
    for (const value of urls) {
      try {
        const link = new URL(value);
        if (
          !localApiPattern.test(link.origin) ||
          link.pathname !== "/auth/v1/verify" ||
          link.searchParams.get("type") !== "recovery"
        ) continue;
        const token = link.searchParams.get("token");
        if (token) return token;
      } catch {
        // Ignore non-URL message fragments.
      }
    }
  }
  throw new Error("Local reset email did not contain a valid recovery link");
}

async function completePasswordReset({ url, publishableKey, profile, mailpitMessageId }) {
  const messageResult = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(mailpitMessageId)}`);
  if (!messageResult.ok) throw new Error("Local reset message disappeared from Mailpit");
  const recoveryToken = findRecoveryToken(await messageResult.json());
  const recoveryClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const password = `Local-${crypto.randomUUID()}-Aa1!`;
  const { data: verified, error: verifyError } = await recoveryClient.auth.verifyOtp({
    token_hash: recoveryToken,
    type: "recovery"
  });
  if (verifyError || !verified.session) {
    throw new Error("Local recovery link could not initialize a reset session");
  }

  const { error: updateError } = await recoveryClient.auth.updateUser({ password });
  if (updateError) throw new Error("Local recovery session could not set a new password");
  const { data: completed, error: completeError } = await recoveryClient.rpc("complete_password_reset");
  if (completeError || completed !== true) {
    throw new Error("Local recovery flow could not clear the forced-reset state");
  }
  await recoveryClient.auth.signOut({ scope: "local" });
  return password;
}

async function run() {
  const localEnv = resolve(backendRoot, "test-db/.env");
  const backendEnv = resolve(backendRoot, ".env");
  if (!fs.existsSync(localEnv) || !fs.existsSync(backendEnv) || fs.realpathSync(backendEnv) !== fs.realpathSync(localEnv)) {
    throw new Error("This test requires backend/.env to point to the dedicated test database config");
  }
  dotenv.config({ path: backendEnv, quiet: true });

  const { url, serviceRoleKey, publishableKey } = localCredentials();
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: profiles, error: profileError } = await admin
    .from("user_management_read_model")
    .select("id,auth_user_id,login_name,email,is_active,roles")
    .eq("is_active", true)
    .limit(1000);
  if (profileError) throw new Error("Could not inspect local imported Auth accounts");

  const profile = (profiles ?? []).find(row =>
    row.roles?.some(role => role.code === "SUPER_ADMIN")
  );
  if (!profile || !profile.auth_user_id) {
    throw new Error("No imported SUPER_ADMIN account is available in Supabase Local");
  }

  const auditStartAt = new Date().toISOString();
  const server = startEdgeFunctions();
  const createdMessageIds = [];
  let accountClient;
  try {
    await waitForEdgeFunctions(server, url, publishableKey);
    const messagesBefore = await mailpitMessagesFor(profile.email);
    const resetResponse = await fetch(`${url}/functions/v1/password-reset`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: localRedirectOrigin
      },
      body: JSON.stringify({ loginName: profile.login_name })
    });
    const resetBody = await resetResponse.json().catch(() => null);
    if (resetResponse.status !== 200 || resetBody?.success !== true) {
      throw new Error(`Local account password reset request failed (HTTP ${resetResponse.status}, code=${resetBody?.error?.code ?? "none"})`);
    }

    let resetMessage;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const messages = await mailpitMessagesFor(profile.email);
      resetMessage = messages.find(message =>
        !messagesBefore.some(previous => previous.ID === message.ID)
      );
      if (resetMessage) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
    if (!resetMessage) throw new Error("Local password reset email did not arrive in Mailpit");
    createdMessageIds.push(resetMessage.ID);

    const password = await completePasswordReset({
      url,
      publishableKey,
      profile,
      mailpitMessageId: resetMessage.ID
    });
    accountClient = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: login, error: loginError } = await accountClient.functions.invoke("session-login", {
      body: { loginName: profile.login_name, password }
    });
    const accessToken = login?.data?.tokens?.accessToken;
    const refreshToken = login?.data?.tokens?.refreshToken;
    if (loginError || login?.success !== true || typeof accessToken !== "string" || typeof refreshToken !== "string") {
      throw new Error("Account/password Edge login failed after local reset");
    }

    const { error: sessionError } = await accountClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (sessionError) throw new Error("The account/password Session could not be initialized");
    const { data: businessId, error: businessIdError } = await accountClient.rpc("current_business_user_id");
    if (businessIdError || businessId !== profile.id) {
      throw new Error("Supabase did not resolve the caller's own business ID");
    }
    const { data: navigation, error: navigationError } = await accountClient.rpc("current_navigation");
    if (
      navigationError || !Array.isArray(navigation) ||
      !navigation.some(item => item.routeKey === "administration.users")
    ) {
      throw new Error("Supabase did not return the SUPER_ADMIN navigation entries");
    }

    const anonymousRoutes = await fetch(`${fastifyUrl}/get-async-routes`);
    if (anonymousRoutes.status !== 401) throw new Error("Fastify did not reject anonymous dynamic-route access");
    const bridgeResponse = await fetch(`${fastifyUrl}/session/legacy-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const bridgeBody = await bridgeResponse.json().catch(() => null);
    const legacyAccessToken = bridgeBody?.data?.accessToken;
    const legacyRefreshToken = bridgeBody?.data?.refreshToken;
    if (
      bridgeResponse.status !== 200 || bridgeBody?.success !== true ||
      typeof legacyAccessToken !== "string" || typeof legacyRefreshToken !== "string"
    ) {
      throw new Error("Fastify rejected the registered account/password Session");
    }

    const refreshResponse = await fetch(`${fastifyUrl}/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: legacyRefreshToken })
    });
    const refreshedBody = await refreshResponse.json().catch(() => null);
    if (
      refreshResponse.status !== 200 || refreshedBody?.success !== true ||
      typeof refreshedBody?.data?.accessToken !== "string" ||
      typeof refreshedBody?.data?.refreshToken !== "string"
    ) {
      throw new Error("Fastify rejected a valid legacy refresh token");
    }

    const invalidRefreshResponse = await fetch(`${fastifyUrl}/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "invalid-local-test-refresh-token" })
    });
    const invalidRefreshBody = await invalidRefreshResponse.json().catch(() => null);
    if (
      invalidRefreshResponse.status !== 401 ||
      invalidRefreshBody?.error?.code !== "UNAUTHORIZED"
    ) {
      throw new Error("Fastify did not reject an invalid legacy refresh token");
    }

    const routesResponse = await fetch(`${fastifyUrl}/get-async-routes`, {
      headers: { Authorization: `Bearer ${legacyAccessToken}` }
    });
    const routesBody = await routesResponse.json().catch(() => null);
    if (routesResponse.status !== 200 || routesBody?.success !== true || !Array.isArray(routesBody.data) || routesBody.data.length === 0) {
      throw new Error("Fastify legacy JWT did not load the user's MySQL dynamic routes");
    }

    process.stdout.write(`${JSON.stringify({
      resetEmailCaptured: true,
      accountPasswordLogin: true,
      registeredSession: true,
      supabaseNavigation: navigation.length,
      anonymousRoutesRejected: true,
      legacyJwtIssued: true,
      validLegacyRefreshAccepted: true,
      invalidLegacyRefreshRejected: true,
      dynamicRouteCount: routesBody.data.length
    })}\n`);
  } finally {
    if (accountClient) {
      try {
        await accountClient.rpc("revoke_account_password_session");
      } catch {
        // The caller session is always cleared locally below.
      }
      await accountClient.auth.signOut({ scope: "local" });
    }
    const { error: auditCleanupError } = await admin
      .from("login_logs")
      .delete()
      .in("login_name", [profile.login_name, "__codex_edge_readiness__"])
      .gte("logged_at", auditStartAt);
    if (auditCleanupError) throw new Error("Could not clean local account/password audit fixtures");
    if (createdMessageIds.length) {
      await fetch(`${mailpitUrl}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: createdMessageIds })
      });
    }
    server.kill("SIGINT");
    await new Promise(resolveExit => {
      if (server.exitCode !== null) return resolveExit();
      server.once("exit", () => resolveExit());
    });
  }
}

run().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Local Auth bridge test failed"}\n`);
  process.exitCode = 1;
});
