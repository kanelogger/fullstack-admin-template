import type { Page } from "@playwright/test";

export interface MockProfile {
  userId: string;
  authUserId: string;
  loginName: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  email?: string;
  sessionId?: string;
}

/** Seed Supabase Auth storage for isolated UI specs; each spec mocks its own data services. */
export async function installSupabaseSessionMock(
  page: Page,
  profile: MockProfile
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  const fixtureMarker = `${storageKey}-playwright-initialized`;
  const sessionId = profile.sessionId ?? `00000000-0000-4000-8000-${profile.authUserId.replaceAll("-", "").slice(-12)}`;
  const encodedPayload = Buffer.from(JSON.stringify({
    sub: profile.authUserId,
    session_id: sessionId,
    aud: "authenticated",
    role: "authenticated",
    exp: expiresAt,
    amr: [{ method: "password", timestamp: expiresAt - 1 }]
  })).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${encodedPayload}.test-signature`,
    refresh_token: `playwright-${profile.authUserId}-refresh`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: profile.authUserId,
      aud: "authenticated",
      role: "authenticated",
      email: profile.email ?? `${profile.loginName}@example.test`,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: "2026-10-01T00:00:00.000Z"
    }
  };

  await page.addInitScript(({ storageKey, fixtureMarker, session }) => {
    if (sessionStorage.getItem(fixtureMarker)) return;
    localStorage.setItem(storageKey, JSON.stringify(session));
    sessionStorage.setItem(fixtureMarker, "1");
  }, { storageKey, fixtureMarker, session });

  // UI fixture specs validate socket-driven state through explicit mocked
  // inputs; keep the client WebSocket local to the browser context.
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => {});

  await page.route("**/rest/v1/rpc/current_profile", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: profile.userId,
      authUserId: profile.authUserId,
      loginName: profile.loginName,
      displayName: profile.displayName,
      email: profile.email ?? `${profile.loginName}@example.test`,
      phone: null,
      avatarUrl: null,
      isActive: true,
      mustResetPassword: false,
      roleCodes: profile.roles,
      permissionKeys: profile.permissions
    })
  }));
}
