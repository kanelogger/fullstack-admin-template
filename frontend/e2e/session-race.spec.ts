import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

test("logout prevents a delayed session refresh from restoring the PC browser session", async ({ page }) => {
  const businessUserId = "910000000000101";
  const authUserId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
  const profile = {
    id: businessUserId,
    authUserId,
    loginName: "common-user",
    displayName: "普通用户",
    email: "common-user@example.test",
    phone: null,
    avatarUrl: null,
    isActive: true,
    mustResetPassword: false,
    roleCodes: ["COMMON_USER"],
    permissionKeys: ["communication.messages.read"]
  };
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "common-user",
    displayName: "普通用户",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "21",
      parentId: null,
      kind: "route",
      routeKey: "communication.messages",
      path: "/operation/messages",
      title: "消息中心",
      icon: "Message",
      sortOrder: 0,
      requiredPermissionKey: "communication.messages.read"
    }])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(businessUserId)
  }));
  await page.route("**/rest/v1/rpc/revoke_account_password_session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "true"
  }));
  await page.route("**/rest/v1/message_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  await page.goto("/#/operation/messages");
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();

  let delayNextProfile = false;
  let releaseProfile!: () => void;
  let markProfilePending!: () => void;
  const profilePending = new Promise<void>(resolve => {
    markProfilePending = resolve;
  });
  await page.route("**/rest/v1/rpc/current_profile", async route => {
    if (!delayNextProfile) return route.fallback();
    delayNextProfile = false;
    markProfilePending();
    await new Promise<void>(resolve => {
      releaseProfile = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profile)
    });
  });

  delayNextProfile = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await profilePending;
  await page.getByLabel("用户菜单：普通用户").click();
  await page.getByRole("menuitem", { name: "退出系统" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  releaseProfile();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem("sb-127-auth-token")),
    { timeout: 10_000 }
  ).toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});

test("profile Auth denial clears the app Session while temporary failures preserve it", async ({ page }) => {
  const businessUserId = "910000000000111";
  const authUserId = "7f9619ff-8b86-4011-b42d-00cf4fc964ff";
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "profile-check",
    displayName: "资料检查用户",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "31",
      parentId: null,
      kind: "route",
      routeKey: "communication.messages",
      path: "/operation/messages",
      title: "消息中心",
      icon: "Message",
      sortOrder: 0,
      requiredPermissionKey: "communication.messages.read"
    }])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(businessUserId)
  }));
  await page.route("**/rest/v1/rpc/revoke_account_password_session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "true"
  }));
  await page.route("**/rest/v1/message_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  await page.goto("/#/operation/messages");
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();

  const failures: Array<{ status?: number; code?: string; message: string; abort?: boolean }> = [
    { status: 503, code: "PGRST000", message: "upstream unavailable" },
    { abort: true, message: "network disconnected during route restore" },
    { status: 401, code: "PGRST301", message: "JWT rejected" }
  ];
  const pendingResponses: Array<() => void> = [];
  await page.route("**/rest/v1/rpc/current_profile", async route => {
    const failure = failures.shift();
    if (!failure) return route.fallback();
    if (failure.abort) {
      await route.abort("failed");
      pendingResponses.shift()?.();
      return;
    }
    await route.fulfill({
      status: failure.status ?? 503,
      contentType: "application/json",
      body: JSON.stringify({ code: failure.code ?? "", message: failure.message })
    });
    pendingResponses.shift()?.();
  });

  async function triggerProfileRefresh() {
    let finish!: () => void;
    const response = new Promise<void>(resolve => {
      finish = resolve;
    });
    pendingResponses.push(finish);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await response;
  }

  async function triggerNavigationRestore() {
    let finish!: () => void;
    const response = new Promise<void>(resolve => {
      finish = resolve;
    });
    pendingResponses.push(finish);
    await page.evaluate(() => {
      const originalNow = Date.now;
      Date.now = () => originalNow() + 61_000;
      window.location.hash = "#/operation/messages?restore=temporary";
    });
    await response;
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/restore=temporary/);
  }

  await triggerProfileRefresh();
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).not.toBeNull();

  await triggerNavigationRestore();
  await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
  await expect(page.getByLabel("用户菜单：资料检查用户")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).not.toBeNull();

  await triggerProfileRefresh();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).toBeNull();
});

test("first-load profile Auth rejection removes only the rejected persisted Session", async ({ page }) => {
  const businessUserId = "910000000000112";
  const authUserId = "8f9619ff-8b86-4011-b42d-00cf4fc964ff";
  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    loginName: "first-load-rejected",
    displayName: "首次加载拒绝用户",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await page.route("**/rest/v1/rpc/current_profile", route => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ code: "PGRST301", message: "JWT rejected" })
  }));
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204, body: "" }));

  await page.goto("/#/operation/messages");

  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).toBeNull();
});

test("a second tab can switch accounts while logout serializes Session changes", async ({ page, context }) => {
  const originalAuthUserId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
  const originalBusinessUserId = "910000000000131";
  const nextAuthUserId = "9f9619ff-8b86-4011-b42d-00cf4fc964ff";
  const nextSessionId = "33333333-3333-4333-8333-333333333333";
  const nextBusinessUserId = "910000000000132";
  const nextAccessToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({
    sub: nextAuthUserId,
    session_id: nextSessionId,
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }]
  })).toString("base64url")}.test-signature`;
  const nextProfile = {
    id: nextBusinessUserId,
    authUserId: nextAuthUserId,
    loginName: "replacement-user",
    displayName: "切换后账号",
    email: "replacement-user@example.test",
    phone: null,
    avatarUrl: null,
    isActive: true,
    roleCodes: ["COMMON_USER"],
    permissionKeys: ["communication.messages.read"],
    mustResetPassword: false
  };
  const navigation = [{
    id: "24",
    parentId: null,
    kind: "route",
    routeKey: "communication.messages",
    path: "/operation/messages",
    title: "消息中心",
    icon: "Message",
    sortOrder: 0,
    requiredPermissionKey: "communication.messages.read"
  }];
  let releaseOriginalRevoke!: () => void;
  let markOriginalRevokePending!: () => void;
  let originalRevokeStarted = false;
  let originalRevokeReleased = false;
  let markOriginalRevokeFinished!: () => void;
  const originalRevokePending = new Promise<void>(resolve => {
    markOriginalRevokePending = resolve;
  });
  const originalRevokeFinished = new Promise<void>(resolve => {
    markOriginalRevokeFinished = resolve;
  });
  let secondTab: typeof page | undefined;

  await installSupabaseSessionMock(page, {
    userId: originalBusinessUserId,
    authUserId: originalAuthUserId,
    loginName: "original-user",
    displayName: "原账号",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(navigation)
  }));
  await page.route("**/rest/v1/rpc/current_profile", route => {
    if (!route.request().headers().authorization?.includes(nextAccessToken)) {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(nextProfile)
    });
  });
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(
      route.request().headers().authorization?.includes(nextAccessToken)
        ? nextBusinessUserId
        : originalBusinessUserId
    )
  }));
  await page.route("**/rest/v1/rpc/revoke_account_password_session", async route => {
    originalRevokeStarted = true;
    markOriginalRevokePending();
    await new Promise<void>(resolve => {
      releaseOriginalRevoke = resolve;
    });
    originalRevokeReleased = true;
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    } finally {
      markOriginalRevokeFinished();
    }
  });
  await page.route("**/rest/v1/message_read_model**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  try {
    await page.goto("/#/operation/messages");
    await expect(page.getByRole("heading", { name: "消息中心" })).toBeVisible();
    await page.getByLabel("用户菜单：原账号").click();
    await page.getByRole("menuitem", { name: "退出系统" }).click();
    await originalRevokePending;

    secondTab = await context.newPage();
    await installSupabaseSessionMock(secondTab, {
      userId: originalBusinessUserId,
      authUserId: originalAuthUserId,
      loginName: "original-user",
      displayName: "原账号",
      roles: ["COMMON_USER"],
      permissions: ["communication.messages.read"]
    });
    await secondTab.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(navigation)
    }));
    await secondTab.route("**/rest/v1/rpc/current_profile", route => {
      if (!route.request().headers().authorization?.includes(nextAccessToken)) {
        return route.fallback();
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(nextProfile)
      });
    });
    await secondTab.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(originalBusinessUserId)
    }));
    await secondTab.route("**/rest/v1/rpc/revoke_account_password_session", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "true"
    }));
    await secondTab.route("**/auth/v1/logout*", route => route.fulfill({ status: 204, body: "" }));
    await secondTab.route("**/functions/v1/session-login", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          session: {
            profile: {
              id: nextBusinessUserId,
              authUserId: nextAuthUserId,
              loginName: "replacement-user",
              displayName: "切换后账号",
              email: "replacement-user@example.test",
              phone: null,
              avatarUrl: null,
              isActive: true
            },
            roleCodes: ["COMMON_USER"],
            permissionKeys: ["communication.messages.read"],
            mustResetPassword: false
          },
          tokens: {
            accessToken: nextAccessToken,
            refreshToken: "replacement-user-refresh",
            expiresAt: Math.floor(Date.now() / 1000) + 3600
          }
        }
      })
    }));
    await secondTab.route("**/auth/v1/user", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: nextAuthUserId,
        aud: "authenticated",
        role: "authenticated",
        email: "replacement-user@example.test",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        created_at: "2026-10-01T00:00:00.000Z"
      })
    }));
    await secondTab.route("**/rest/v1/message_read_model**", route => route.fulfill({
      status: 200,
      headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
      body: "[]"
    }));
    await secondTab.route("**/rest/v1/messages**", route => route.fulfill({
      status: 200,
      headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
      body: "[]"
    }));

    await secondTab.goto("/#/operation/messages");
    await expect(secondTab.getByRole("heading", { name: "消息中心" })).toBeVisible();
    await secondTab.getByLabel("用户菜单：原账号").click();
    await secondTab.getByRole("menuitem", { name: "退出系统" }).click();
    await expect(secondTab.getByRole("button", { name: "登录" })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

    await secondTab.getByRole("textbox", { name: "账号" }).fill("replacement-user");
    await secondTab.getByRole("textbox", { name: "密码" }).fill("replacement-password");
    await secondTab.getByRole("button", { name: "登录" }).click();
    await expect(secondTab.getByLabel("用户菜单：切换后账号")).toBeVisible();
    await expect(page.getByLabel("用户菜单：切换后账号")).toBeVisible({ timeout: 10_000 });
    expect(originalRevokeReleased).toBe(false);
    releaseOriginalRevoke();
    await originalRevokeFinished;
    await expect(secondTab.getByLabel("用户菜单：切换后账号")).toBeVisible();
    await expect(page.getByLabel("用户菜单：切换后账号")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("用户菜单：切换后账号")).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const value = localStorage.getItem("sb-127-auth-token");
      return value ? JSON.parse(value).user?.id : null;
    })).toBe(nextAuthUserId);
  } finally {
    if (originalRevokeStarted && !originalRevokeReleased) releaseOriginalRevoke();
    if (originalRevokeStarted) await originalRevokeFinished;
    await secondTab?.close();
  }
});

test("same-account re-login during logout keeps the newer Auth Session", async ({ page, context }) => {
  const authUserId = "4f9619ff-8b86-4011-b42d-00cf4fc964ff";
  const businessUserId = "910000000000141";
  const oldSessionId = "44444444-4444-4444-8444-444444444444";
  const newSessionId = "55555555-5555-4555-8555-555555555555";
  const nextAccessToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({
    sub: authUserId,
    session_id: newSessionId,
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }]
  })).toString("base64url")}.new-signature00`;
  const profile = {
    id: businessUserId,
    authUserId,
    loginName: "same-user",
    displayName: "同一账号",
    email: "same-user@example.test",
    phone: null,
    avatarUrl: null,
    isActive: true,
    roleCodes: ["COMMON_USER"],
    permissionKeys: ["communication.messages.read"],
    mustResetPassword: false
  };
  const navigation = [{
    id: "25",
    parentId: null,
    kind: "route",
    routeKey: "communication.messages",
    path: "/operation/messages",
    title: "消息中心",
    icon: "Message",
    sortOrder: 0,
    requiredPermissionKey: "communication.messages.read"
  }];
  let releaseRevoke!: () => void;
  let markRevokeStarted!: () => void;
  const revokeStarted = new Promise<void>(resolve => { markRevokeStarted = resolve; });
  let revokedAuthorization = "";
  let revokeWasHeld = false;
  const installRoutes = async (targetPage: typeof page, holdRevoke: boolean) => {
    await targetPage.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(navigation)
    }));
    await targetPage.route("**/rest/v1/rpc/current_profile", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profile)
    }));
    await targetPage.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(businessUserId)
    }));
    await targetPage.route("**/rest/v1/message_read_model**", route => route.fulfill({
      status: 200,
      headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
      body: "[]"
    }));
    await targetPage.route("**/rest/v1/messages**", route => route.fulfill({
      status: 200,
      headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
      body: "[]"
    }));
    await targetPage.route("**/functions/v1/session-login", route => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
        success: true,
        data: {
          session: {
            profile: {
              id: businessUserId,
              authUserId,
              loginName: "same-user",
              displayName: "同一账号",
              email: "same-user@example.test",
              phone: null,
              avatarUrl: null,
              isActive: true
            },
            roleCodes: ["COMMON_USER"],
            permissionKeys: ["communication.messages.read"],
            mustResetPassword: false
          },
          tokens: {
            accessToken: nextAccessToken,
            refreshToken: "same-user-new-refresh",
            expiresAt: Math.floor(Date.now() / 1000) + 3600
          }
        }
        })
      });
    });
    await targetPage.route("**/auth/v1/user", route => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
        id: authUserId,
        aud: "authenticated",
        role: "authenticated",
        email: "same-user@example.test",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        created_at: "2026-10-01T00:00:00.000Z"
        })
      }));
    await targetPage.route("**/auth/v1/logout*", route => route.fulfill({ status: 204, body: "" }));
    await targetPage.route("**/rest/v1/rpc/revoke_account_password_session", async route => {
      if (holdRevoke && !revokeWasHeld) {
        revokeWasHeld = true;
        revokedAuthorization = route.request().headers().authorization ?? "";
        markRevokeStarted();
        await new Promise<void>(resolve => { releaseRevoke = resolve; });
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    });
  };

  await installSupabaseSessionMock(page, {
    userId: businessUserId,
    authUserId,
    sessionId: oldSessionId,
    loginName: "same-user",
    displayName: "同一账号",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await installRoutes(page, true);
  await page.goto("/#/operation/messages");
  await expect(page.getByLabel("用户菜单：同一账号")).toBeVisible();

  const secondTab = await context.newPage();
  await installSupabaseSessionMock(secondTab, {
    userId: businessUserId,
    authUserId,
    sessionId: oldSessionId,
    loginName: "same-user",
    displayName: "同一账号",
    roles: ["COMMON_USER"],
    permissions: ["communication.messages.read"]
  });
  await installRoutes(secondTab, false);
  await secondTab.goto("/#/operation/messages");
  await expect(secondTab.getByLabel("用户菜单：同一账号")).toBeVisible();

  await page.getByLabel("用户菜单：同一账号").click();
  await page.getByRole("menuitem", { name: "退出系统" }).click();
  await revokeStarted;

  await secondTab.getByLabel("用户菜单：同一账号").click();
  await secondTab.getByRole("menuitem", { name: "退出系统" }).click();
  await expect(secondTab.getByRole("button", { name: "登录" })).toBeVisible();
  await secondTab.getByRole("textbox", { name: "账号" }).fill("same-user");
  await secondTab.getByRole("textbox", { name: "密码" }).fill("same-user-password");
  await secondTab.getByRole("button", { name: "登录" }).click();
  const readSecondSessionId = () => secondTab.evaluate(() => {
    const stored = localStorage.getItem("sb-127-auth-token");
    const token = stored ? JSON.parse(stored).access_token as string : "";
    const encoded = token.split(".")[1] ?? "";
    const payload = encoded.replaceAll("-", "+").replaceAll("_", "/");
    return payload ? JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).session_id : null;
  });
  await expect.poll(readSecondSessionId, { timeout: 5_000 }).toBe(newSessionId);
  await expect(secondTab.getByLabel("用户菜单：同一账号")).toBeVisible();
  await expect(page.getByLabel("用户菜单：同一账号")).toBeVisible({ timeout: 10_000 });
  expect(revokeWasHeld).toBe(true);

  releaseRevoke();
  const revokedToken = revokedAuthorization.replace(/^Bearer\s+/i, "");
  const revokedPayload = revokedToken.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
  expect(JSON.parse(atob(revokedPayload.padEnd(Math.ceil(revokedPayload.length / 4) * 4, "="))))
    .toMatchObject({ sub: authUserId, session_id: oldSessionId });
  const persistedIdentity = await page.evaluate(() => {
    const stored = localStorage.getItem("sb-127-auth-token");
    if (!stored) return null;
    const token = JSON.parse(stored).access_token as string;
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
  });
  expect(persistedIdentity).toMatchObject({ sub: authUserId, session_id: newSessionId });
  expect(persistedIdentity.session_id).not.toBe(oldSessionId);
});
