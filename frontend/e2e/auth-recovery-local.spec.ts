import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const frontendRoot = process.cwd();
const repositoryRoot = resolve(frontendRoot, "..");
const backendRoot = resolve(repositoryRoot, "backend");
const backendRequire = createRequire(resolve(backendRoot, "package.json"));
const dotenv = backendRequire("dotenv");
const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");
const localAuthApi = /^http:\/\/(127\.0\.0\.1|localhost):54321$/;
const mailpitUrl = "http://127.0.0.1:54324";

function localSupabaseStatus() {
  const result = spawnSync(supabaseCli, ["--workdir", repositoryRoot, "status", "--output", "json"], {
    cwd: frontendRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) throw new Error("Supabase Local is not running");
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    throw new Error("Supabase Local status could not be read");
  }
  const url = status.API_URL ?? status.api_url;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
  if (!localAuthApi.test(url ?? "") || !publishableKey || !serviceRoleKey) {
    throw new Error("This test only accepts the project's local Supabase API");
  }
  return { url, publishableKey, serviceRoleKey };
}

async function waitForFunctions(child: ReturnType<typeof spawn>, url: string, publishableKey: string) {
  const headers = {
    apikey: publishableKey,
    "Content-Type": "application/json",
    Origin: "http://127.0.0.1:8848"
  };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Local Edge Functions did not start");
    try {
      const login = await fetch(`${url}/functions/v1/session-login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ loginName: "__codex_edge_readiness__", password: "invalid-test-password" })
      });
      const loginBody = await login.json().catch(() => null);
      const reset = await fetch(`${url}/functions/v1/password-reset`, {
        method: "POST",
        headers,
        body: JSON.stringify({ loginName: "__codex_edge_readiness__" })
      });
      const resetBody = await reset.json().catch(() => null);
      if (login.status === 401 && loginBody?.error?.code === "INVALID_CREDENTIALS" && reset.status === 200 && resetBody?.success) {
        return;
      }
    } catch {
      // Wait until the gateway and both function bundles answer their probes.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  throw new Error("Local Edge Functions did not become ready");
}

async function messagesFor(email: string) {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?start=0&limit=100`);
  if (!response.ok) throw new Error("Local Mailpit is not available");
  const result = await response.json();
  return (result.messages ?? []).filter(message =>
    message.ID && message.To?.some((recipient: { Address?: string }) => recipient.Address?.toLowerCase() === email.toLowerCase())
  );
}

function recoveryLink(message: Record<string, unknown>, localUrl: string): string {
  const bodies = [message.Text, message.HTML].filter((value): value is string => typeof value === "string");
  const observedLinks: Array<{ origin: string; path: string; params: string[]; type: string | null; redirectOrigin: string | null }> = [];
  for (const body of bodies) {
    for (const match of body.matchAll(/https?:\/\/[^\s"<>]+/g)) {
      try {
        const link = new URL(match[0].replaceAll("&amp;", "&"));
        let redirectOrigin: string | null = null;
        try {
          const redirectTo = link.searchParams.get("redirect_to");
          redirectOrigin = redirectTo ? new URL(redirectTo).origin : null;
        } catch {
          redirectOrigin = "invalid";
        }
        observedLinks.push({
          origin: link.origin,
          path: link.pathname,
          params: [...link.searchParams.keys()],
          type: link.searchParams.get("type"),
          redirectOrigin
        });
        if (
          link.origin === localUrl &&
          link.pathname === "/auth/v1/verify" &&
          link.searchParams.get("type") === "recovery" &&
          link.searchParams.has("token")
        ) return link.toString();
      } catch {
        // Ignore unrelated message text.
      }
    }
  }
  throw new Error(`Captured email has no local password-recovery action link; metadata=${JSON.stringify(observedLinks)}`);
}

function authMethods(accessToken: string): string[] {
  try {
    const payload = accessToken.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Array.isArray(claims.amr)
      ? claims.amr.flatMap((entry: { method?: unknown }) => typeof entry?.method === "string" ? [entry.method] : [])
      : [];
  } catch {
    return [];
  }
}

test("real local recovery action link opens the SPA reset page and permits account/password login", async ({ page }) => {
  test.skip(process.env.E2E_LOCAL_AUTH !== "1", "Run pnpm test:e2e:auth to enable the real local Auth flow");

  const dedicatedEnv = resolve(backendRoot, "test-db/.env");
  const backendEnv = resolve(backendRoot, ".env");
  if (realpathSync(backendEnv) !== realpathSync(dedicatedEnv)) {
    throw new Error("Real Auth browser test requires backend/.env to point to the dedicated test database");
  }
  const mysqlEnv = dotenv.parse(readFileSync(dedicatedEnv));
  if (mysqlEnv.MYSQL_DATABASE !== "fullstack_admin_template_test") {
    throw new Error("Real Auth browser test only accepts the dedicated synthetic MySQL test database");
  }

  const { url, publishableKey, serviceRoleKey } = localSupabaseStatus();
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: profiles, error: profileError } = await admin
    .from("user_management_read_model")
    .select("id,auth_user_id,login_name,email,is_active,roles")
    .eq("is_active", true)
    .limit(1000);
  if (profileError) throw new Error("Could not inspect local synthetic Auth users");
  const profile = (profiles ?? []).find(row =>
    row.login_name === "superadmin" && row.roles?.some((role: { code?: string }) => role.code === "SUPER_ADMIN")
  );
  if (!profile?.auth_user_id) throw new Error("Dedicated local SUPER_ADMIN Auth profile is missing");

  const auditStartAt = new Date().toISOString();
  const previousMessages = await messagesFor(profile.email);
  const edgeServer = spawn(supabaseCli, ["--workdir", repositoryRoot, "functions", "serve", "--no-verify-jwt"], {
    cwd: frontendRoot,
    stdio: "ignore",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  const newMessageIds: string[] = [];
  let accountClient: ReturnType<typeof createClient> | undefined;
  let recoveryAccessToken: string | undefined;
  try {
    await waitForFunctions(edgeServer, url, publishableKey);
    const resetResponse = await fetch(`${url}/functions/v1/password-reset`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8848"
      },
      body: JSON.stringify({ loginName: profile.login_name })
    });
    const resetBody = await resetResponse.json().catch(() => null);
    if (resetResponse.status !== 200 || resetBody?.success !== true) {
      throw new Error("Password-reset Edge Function did not accept the local request");
    }

    let resetMessage;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const messages = await messagesFor(profile.email);
      resetMessage = messages.find((message: { ID: string }) =>
        !previousMessages.some((previous: { ID: string }) => previous.ID === message.ID)
      );
      if (resetMessage) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
    if (!resetMessage) throw new Error("Password-reset email was not captured by local Mailpit");
    newMessageIds.push(resetMessage.ID);
    const messageDetailResponse = await fetch(
      `${mailpitUrl}/api/v1/message/${encodeURIComponent(resetMessage.ID)}`
    );
    if (!messageDetailResponse.ok) throw new Error("Captured reset email detail is unavailable");
    const messageDetail = await messageDetailResponse.json();
    page.on("framenavigated", frame => {
      const hash = new URL(frame.url()).hash;
      for (const part of hash.split("#").slice(1)) {
        const token = new URLSearchParams(part).get("access_token");
        if (token && authMethods(token).some(method => method === "recovery" || method === "otp")) {
          recoveryAccessToken = token;
        }
      }
    });
    await page.goto(recoveryLink(messageDetail, url));
    await expect.poll(() => Boolean(recoveryAccessToken)).toBe(true);
    await expect(page.getByRole("heading", { name: "重置密码" })).toBeVisible();
    const newPasswordInput = page.getByRole("textbox", { name: "新密码", exact: true });
    const confirmPasswordInput = page.getByRole("textbox", { name: "确认新密码", exact: true });
    await expect(newPasswordInput).toBeVisible();
    expect(page.url()).not.toContain("access_token");
    await newPasswordInput.fill(`Browser-${crypto.randomUUID()}-Aa1!`);
    const password = await newPasswordInput.inputValue();
    await confirmPasswordInput.fill(password);
    await page.getByRole("button", { name: "保存新密码" }).click();
    await expect(page).toHaveURL(/#\/login$/);

    const accountLogin = await fetch(`${url}/functions/v1/session-login`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8848"
      },
      body: JSON.stringify({ loginName: profile.login_name, password })
    });
    const loginBody = await accountLogin.json().catch(() => null);
    const tokens = loginBody?.data?.tokens;
    if (
      accountLogin.status !== 200 || loginBody?.success !== true ||
      typeof tokens?.accessToken !== "string" ||
      !authMethods(tokens.accessToken).includes("password")
    ) {
      throw new Error("The reset account did not sign in through the account/password Edge flow");
    }

    accountClient = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: sessionError } = await accountClient.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });
    if (sessionError) throw new Error("The account/password Session could not be initialized");
    const { data: profileResult, error: profileRpcError } = await accountClient.rpc("current_profile");
    if (profileRpcError || profileResult?.id !== profile.id) {
      throw new Error("The password session could not read its own profile");
    }

    process.stdout.write(`${JSON.stringify({
      recoveryActionLinkOpenedInBrowser: true,
      resetPageSessionRestored: true,
      recoverySessionCapturedAndRevoked: Boolean(recoveryAccessToken),
      forcedResetCleared: true,
      accountPasswordLogin: true,
      registeredProfileRead: true
    })}\n`);
  } finally {
    if (recoveryAccessToken) {
      await admin.auth.admin.signOut(recoveryAccessToken, "global").catch(() => undefined);
    }
    if (accountClient) {
      try {
        await accountClient.rpc("revoke_account_password_session");
      } catch {
        // Clear local session even if revocation is unavailable.
      }
      await accountClient.auth.signOut({ scope: "local" });
    }
    const { error: auditCleanupError } = await admin
      .from("login_logs")
      .delete()
      .in("login_name", [profile.login_name, "__codex_edge_readiness__"])
      .gte("logged_at", auditStartAt);
    if (auditCleanupError) throw new Error("Could not clean local account/password audit fixtures");
    if (newMessageIds.length) {
      await fetch(`${mailpitUrl}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: newMessageIds })
      });
    }
    edgeServer.kill("SIGINT");
    await new Promise(resolveExit => {
      if (edgeServer.exitCode !== null) return resolveExit();
      edgeServer.once("exit", () => resolveExit());
    });
  }
});
