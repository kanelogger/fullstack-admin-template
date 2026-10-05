/* eslint-disable no-unsafe-finally -- Cleanup failures must fail isolated Auth acceptance. */
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  captureCleanupFailure,
  localSupabaseStatus,
  stopLocalEdgeServer,
  waitForFunctions
} from "./helpers/local-edge-functions";

const frontendRoot = process.cwd();
const repositoryRoot = resolve(process.env.SUPABASE_PROJECT_ROOT ?? resolve(frontendRoot, ".."));
const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");
const mailpitUrl = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

type AccountFixtureOptions = {
  roleCode?: "SUPER_ADMIN" | "COMMON_USER";
  mustResetPassword?: boolean;
  loginPrefix?: string;
  displayName?: string;
};

async function createRecoveryFixture(
  admin: ReturnType<typeof createClient>,
  options: AccountFixtureOptions = {}
) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const roleCode = options.roleCode ?? "SUPER_ADMIN";
  const mustResetPassword = options.mustResetPassword ?? true;
  const loginPrefix = options.loginPrefix ?? "__codex_recovery";
  const initialPassword = `Fixture-${randomUUID()}-Aa1!`;
  const fixture = {
    loginName: `${loginPrefix}_${suffix}`,
    userCode: `${loginPrefix}_${suffix}`,
    displayName: options.displayName ?? "Disposable recovery test account",
    email: `${loginPrefix}_${suffix}@example.test`
  };
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("code", roleCode)
    .single();
  if (roleError || !role) throw new Error(`Seeded ${roleCode} role is missing`);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: fixture.email,
    password: initialPassword,
    email_confirm: true
  });
  if (createError || !created.user) throw new Error("Could not create the disposable Auth fixture");

  let profileId: string | undefined;
  try {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .insert({
        auth_user_id: created.user.id,
        user_code: fixture.userCode,
        login_name: fixture.loginName,
        display_name: fixture.displayName,
        email: fixture.email,
        is_active: true,
        must_reset_password: mustResetPassword
      })
      .select("id,auth_user_id,login_name,email")
      .single();
    if (profileError || !profile) throw new Error("Could not create the disposable business profile");
    profileId = String(profile.id);

    const { error: assignmentError } = await admin
      .from("user_roles")
      .insert({ user_id: profile.id, role_id: role.id });
    if (assignmentError) throw new Error(`Could not assign the disposable ${roleCode} role`);
    return {
      ...profile,
      id: String(profile.id),
      display_name: fixture.displayName,
      initialPassword
    };
  } catch (error) {
    if (profileId) await admin.from("profiles").delete().eq("id", profileId);
    await admin.auth.admin.deleteUser(created.user.id);
    throw error;
  }
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

function cleanLocalFixtureSql(sql: string): void {
  const result = spawnSync(
    supabaseCli,
    ["--workdir", repositoryRoot, "db", "query", "--local", sql],
    {
      cwd: frontendRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error("Could not clean a disposable browser-flow database fixture");
  }
}

test("local PC browser completes Auth, dictionary CRUD, Realtime, refresh, permission denial, and secure logout", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(process.env.E2E_LOCAL_AUTH !== "1", "Run pnpm test:e2e:auth to enable the real local Auth flow");

  const { url, publishableKey, serviceRoleKey } = localSupabaseStatus({
    frontendRoot,
    repositoryRoot,
    supabaseCli
  });
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const profile = await createRecoveryFixture(admin);
  const authUserId = profile.auth_user_id;

  const auditStartAt = new Date().toISOString();
  const previousMessages = await messagesFor(profile.email);
  const edgeServer = spawn(supabaseCli, ["--workdir", repositoryRoot, "functions", "serve", "--no-verify-jwt"], {
    cwd: frontendRoot,
    stdio: "ignore",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  const newMessageIds: string[] = [];
  let recoveryAccessToken: string | undefined;
  let commonProfile: Awaited<ReturnType<typeof createRecoveryFixture>> | undefined;
  let dictionaryTypeId: string | undefined;
  let realtimeMessageId: string | undefined;
  let testFailure: unknown;
  let testFailed = false;
  try {
    await waitForFunctions(edgeServer, url, publishableKey);
    commonProfile = await createRecoveryFixture(admin, {
      roleCode: "COMMON_USER",
      mustResetPassword: false,
      loginPrefix: "__codex_common",
      displayName: "Disposable common-user browser account"
    });
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

    await page.getByRole("textbox", { name: "账号" }).fill(profile.login_name);
    await page.getByRole("textbox", { name: "密码" }).fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();

    const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    const browserSession = await page.evaluate(key => {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, storageKey);
    if (!browserSession || !authMethods(browserSession.access_token).includes("password")) {
      throw new Error("The PC browser did not establish an account/password Auth Session");
    }
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const dictionaryCode = `pc_e2e_${suffix}`;
    const dictionaryName = `PC E2E ${suffix}`;
    const updatedDictionaryName = `PC E2E Updated ${suffix}`;
    page.on("dialog", dialog => dialog.accept());
    const primaryNav = page.getByRole("complementary", { name: "主导航" });
    await primaryNav.getByText("系统管理", { exact: true }).click();
    const dictionaryLink = primaryNav.getByRole("link", { name: "数据字典" });
    await expect(dictionaryLink).toBeVisible();
    await dictionaryLink.click();
    await expect(page.getByRole("heading", { name: "数据字典" })).toBeVisible();
    await page.getByRole("button", { name: "新增类型" }).click();
    const createTypeDialog = page.getByRole("dialog");
    await createTypeDialog.getByLabel("字典编码").fill(dictionaryCode);
    await createTypeDialog.getByLabel("字典名称").fill(dictionaryName);
    const dictionarySaveResponse = page.waitForResponse(response =>
      response.url().includes("/rest/v1/rpc/save_dictionary_type") &&
      response.request().method() === "POST"
    );
    await createTypeDialog.getByRole("button", { name: "保存", exact: true }).click();
    const savedTypeResponse = await dictionarySaveResponse;
    const savedType = await savedTypeResponse.json().catch(() => null);
    if (!savedTypeResponse.ok() || typeof savedType?.id !== "string") {
      throw new Error("The browser dictionary write did not return the shared string-ID contract");
    }
    dictionaryTypeId = savedType.id;
    const createdTypeRow = page.getByRole("row").filter({ hasText: dictionaryCode });
    await expect(createdTypeRow).toBeVisible();

    await createdTypeRow.getByRole("button", { name: "编辑" }).click();
    const editTypeDialog = page.getByRole("dialog");
    await editTypeDialog.getByLabel("字典名称").fill(updatedDictionaryName);
    await editTypeDialog.getByRole("button", { name: "保存", exact: true }).click();
    const updatedTypeRow = page.getByRole("row").filter({ hasText: updatedDictionaryName });
    await expect(updatedTypeRow).toBeVisible();
    await updatedTypeRow.getByRole("button", { name: "删除" }).click();
    await expect(page.getByText(updatedDictionaryName, { exact: true })).toHaveCount(0);

    await page.goto("/#/operation/messages");
    await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
    await expect(page.getByLabel("消息中心，0 条未读")).toBeVisible();
    const realtimeTitle = `PC Realtime ${suffix}`;
    const { data: createdMessage, error: createdMessageError } = await admin
      .from("messages")
      .insert({
        receiver_id: profile.id,
        sender_id: profile.id,
        title: realtimeTitle,
        summary: "PC browser Realtime acceptance",
        content: "The active inbox subscriber should receive this message.",
        message_type: "NOTICE"
      })
      .select("id")
      .single();
    if (createdMessageError || !createdMessage) throw new Error("Could not create the browser Realtime message");
    realtimeMessageId = String(createdMessage.id);
    await expect(page.getByText(realtimeTitle, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("消息中心，1 条未读")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
    await expect(page.getByText(realtimeTitle, { exact: true })).toBeVisible();
    await expect(page.getByLabel("消息中心，1 条未读")).toBeVisible();

    const profileQuery = new URL(`${url}/rest/v1/profiles`);
    profileQuery.searchParams.set("select", "id");
    profileQuery.searchParams.set("id", `eq.${profile.id}`);
    const readProfileWithBrowserToken = async () => {
      const response = await fetch(profileQuery, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${browserSession.access_token}`
        }
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    };
    const profileBeforeLogout = await readProfileWithBrowserToken();
    if (
      profileBeforeLogout.status !== 200 ||
      !Array.isArray(profileBeforeLogout.body) ||
      !profileBeforeLogout.body.some((row: { id?: unknown }) => String(row.id) === profile.id)
    ) {
      throw new Error("The active browser access token did not read its own Profile");
    }

    await page.goto("/#/profile/info");
    await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
    await expect(page.getByLabel("登录名")).toHaveValue(profile.login_name);

    let delayProfile = false;
    let releaseProfile!: () => void;
    let markProfilePending!: () => void;
    const profilePending = new Promise<void>(resolve => {
      markProfilePending = resolve;
    });
    await page.route("**/rest/v1/rpc/current_profile", async route => {
      if (!delayProfile) return route.continue();
      delayProfile = false;
      markProfilePending();
      await new Promise<void>(resolve => {
        releaseProfile = resolve;
      });
      await route.continue();
    });

    delayProfile = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await profilePending;
    await page.getByLabel(`用户菜单：${profile.display_name}`).click();
    await page.getByRole("button", { name: "退出系统" }).click();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

    releaseProfile();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    const profileAfterLogout = await readProfileWithBrowserToken();
    const oldTokenStillReadsProfile = profileAfterLogout.status === 200 &&
      Array.isArray(profileAfterLogout.body) &&
      profileAfterLogout.body.some((row: { id?: unknown }) => String(row.id) === profile.id);
    if (oldTokenStillReadsProfile || ![200, 401, 403].includes(profileAfterLogout.status)) {
      throw new Error("Logout did not prove that the old access token is rejected by Profile RLS");
    }
    await page.reload();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

    if (!commonProfile) throw new Error("The common-user authorization fixture was not created");
    await page.getByRole("textbox", { name: "账号" }).fill(commonProfile.login_name);
    await page.getByRole("textbox", { name: "密码" }).fill(commonProfile.initialPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByLabel(`用户菜单：${commonProfile.display_name}`)).toBeVisible();
    await page.goto("/#/log/login-logs");
    await expect(page.getByText("抱歉，你无权访问该页面")).toBeVisible();

    process.stdout.write(`${JSON.stringify({
      recoveryActionLinkOpenedInBrowser: true,
      resetPageSessionRestored: true,
      recoverySessionCapturedAndRevoked: Boolean(recoveryAccessToken),
      forcedResetCleared: true,
      accountPasswordLogin: true,
      registeredProfileRead: true,
      delayedRefreshDidNotRestoreAfterLogout: true,
      oldAccessTokenRejectedByRls: true,
      reloadRemainedSignedOut: true,
      directUnauthorizedRouteDenied: true,
      dictionaryCrud: true,
      realtimeInboxDelivery: true,
      protectedRouteRestoredAfterRefresh: true
    })}\n`);
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    const cleanupFailures: Error[] = [];
    if (recoveryAccessToken) {
      await captureCleanupFailure(cleanupFailures, "Could not revoke the recovery session", async () => {
        const { error } = await admin.auth.admin.signOut(recoveryAccessToken, "global");
        // Password reset may already have invalidated this recovery session.
        if (error && error.name !== "AuthSessionMissingError") throw error;
      });
    }
    await captureCleanupFailure(cleanupFailures, "Could not clean local account/password audit fixtures", async () => {
      const { error } = await admin
        .from("login_logs")
        .delete()
        .in("login_name", [profile.login_name, commonProfile?.login_name ?? "__codex_no_fixture__", "__codex_edge_readiness__"])
        .gte("logged_at", auditStartAt);
      if (error) throw error;
    });
    if (dictionaryTypeId) {
      await captureCleanupFailure(cleanupFailures, "Could not clean the local dictionary item fixture", () => {
        if (!/^\d+$/.test(dictionaryTypeId!)) throw new Error("The browser returned a nonnumeric dictionary ID");
        cleanLocalFixtureSql(`delete from public.dict_items where dict_type_id = ${dictionaryTypeId}`);
      });
      await captureCleanupFailure(cleanupFailures, "Could not clean the local dictionary type fixture", () => {
        if (!/^\d+$/.test(dictionaryTypeId!)) throw new Error("The browser returned a nonnumeric dictionary ID");
        cleanLocalFixtureSql(`delete from public.dict_types where id = ${dictionaryTypeId}`);
      });
    }
    if (realtimeMessageId) {
      await captureCleanupFailure(cleanupFailures, "Could not clean the local Realtime message fixture", () => {
        if (!/^\d+$/.test(realtimeMessageId!)) throw new Error("The browser returned a nonnumeric message ID");
        cleanLocalFixtureSql(`delete from public.messages where id = ${realtimeMessageId}`);
      });
    }
    const fixtureProfileIds = [profile.id, commonProfile?.id].filter((id): id is string => Boolean(id));
    await captureCleanupFailure(cleanupFailures, "Could not clean recovery operation-log fixtures", async () => {
      const { error } = await admin.from("operation_logs").delete().in("operator_id", fixtureProfileIds);
      if (error) throw error;
    });
    await captureCleanupFailure(cleanupFailures, "Could not clean recovery role-assignment fixtures", async () => {
      const { error } = await admin.from("user_roles").delete().in("user_id", fixtureProfileIds);
      if (error) throw error;
    });
    await captureCleanupFailure(cleanupFailures, "Could not clean the local recovery profile fixture", async () => {
      const { error } = await admin.from("profiles").delete().eq("id", profile.id);
      if (error) throw error;
    });
    if (commonProfile) {
      await captureCleanupFailure(cleanupFailures, "Could not clean the local common-user profile fixture", async () => {
        const { error } = await admin.from("profiles").delete().eq("id", commonProfile!.id);
        if (error) throw error;
      });
    }
    await captureCleanupFailure(cleanupFailures, "Could not clean the local recovery Auth fixture", async () => {
      const { error } = await admin.auth.admin.deleteUser(authUserId);
      if (error) throw error;
    });
    if (commonProfile) {
      await captureCleanupFailure(cleanupFailures, "Could not clean the local common-user Auth fixture", async () => {
        const { error } = await admin.auth.admin.deleteUser(commonProfile!.auth_user_id);
        if (error) throw error;
      });
    }
    if (newMessageIds.length) {
      await captureCleanupFailure(cleanupFailures, "Could not clean local Mailpit recovery emails", async () => {
        const response = await fetch(`${mailpitUrl}/api/v1/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ IDs: newMessageIds })
        });
        if (!response.ok) throw new Error(`Mailpit returned HTTP ${response.status}`);
      });
    }
    await captureCleanupFailure(cleanupFailures, "Could not stop the local Edge Functions subprocess", () =>
      stopLocalEdgeServer(edgeServer)
    );
    if (cleanupFailures.length) {
      if (testFailed) {
        throw new AggregateError([testFailure, ...cleanupFailures], "Local Auth recovery E2E and cleanup failed");
      }
      throw new AggregateError(cleanupFailures, "Local Auth recovery E2E cleanup failed");
    }
    if (testFailed) throw testFailure;
  }
});
