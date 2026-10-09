import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    functions: { invoke: vi.fn() },
    auth: {
      setSession: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn()
    },
    rpc: vi.fn()
  },
  getCurrentSession: vi.fn()
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => mocks.client
}));
vi.mock("@/features/profile/profile.service", () => ({
  getCurrentSession: mocks.getCurrentSession
}));

import {
  clearRejectedSupabaseSessionIfCurrent,
  loginWithSupabase,
  restorePasswordRecoverySession,
  restoreSupabaseSession
} from "./auth.service";
import { rejectAuthSession } from "./session-generation";

const aliceAuthId = "11111111-1111-4111-8111-111111111111";
const bobAuthId = "22222222-2222-4222-8222-222222222222";
const aliceSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function session(authUserId: string, loginName: string) {
  return {
    profile: {
      id: "9007199254740994",
      authUserId,
      loginName,
      displayName: loginName,
      email: `${loginName}@example.test`,
      phone: null,
      avatarUrl: null,
      isActive: true
    },
    roleCodes: ["SUPER_ADMIN"],
    permissionKeys: [],
    mustResetPassword: false
  };
}

function tokenForSession(authUserId: string, sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: authUserId, session_id: sessionId })).toString(
    "base64url"
  );
  return `header.${payload}.signature`;
}

function supabaseAuthSession(
  authUserId: string,
  sessionId = authUserId === aliceAuthId ? aliceSessionId : bobSessionId
) {
  return {
    access_token: tokenForSession(authUserId, sessionId),
    refresh_token: `refresh-${authUserId}`,
    user: { id: authUserId }
  };
}

function accessTokenWithAmr(method: string): string {
  const payload = Buffer.from(JSON.stringify({ amr: [{ method }] })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("Supabase Auth application session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rejectAuthSession();
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _options: { mode: string },
          callback: (lock: null) => Promise<unknown>
        ) => callback(null)
      }
    });
    mocks.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.client.auth.signOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("logs in with account and password and keeps Supabase as the only session", async () => {
    mocks.client.functions.invoke.mockResolvedValue({
      data: {
        success: true,
        data: {
          session: session(aliceAuthId, "alice"),
          tokens: {
            accessToken: tokenForSession(aliceAuthId, aliceSessionId),
            refreshToken: `refresh-${aliceAuthId}`,
            expiresAt: 1_900_000_000
          }
        }
      },
      error: null
    });
    mocks.client.auth.setSession.mockResolvedValue({
      data: { session: supabaseAuthSession(aliceAuthId) },
      error: null
    });

    const result = await loginWithSupabase({ loginName: "alice", password: "secret" });

    expect(mocks.client.functions.invoke).toHaveBeenCalledWith("session-login", {
      body: { loginName: "alice", password: "secret" }
    });
    expect(mocks.client.auth.setSession).toHaveBeenCalledWith({
      access_token: tokenForSession(aliceAuthId, aliceSessionId),
      refresh_token: `refresh-${aliceAuthId}`
    });
    expect(result).toMatchObject({
      success: true,
      data: session(aliceAuthId, "alice"),
      authSessionId: aliceSessionId
    });
    if (result.success) expect(typeof result.discardIfStale).toBe("function");
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it("does not restore a delayed profile after logout or account switch", async () => {
    mocks.client.auth.getSession
      .mockResolvedValueOnce({ data: { session: supabaseAuthSession(aliceAuthId) }, error: null })
      .mockResolvedValueOnce({ data: { session: supabaseAuthSession(bobAuthId) }, error: null });

    let resolveProfile!: (value: ReturnType<typeof session>) => void;
    mocks.getCurrentSession.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    const pending = restoreSupabaseSession();
    await Promise.resolve();
    rejectAuthSession();
    resolveProfile(session(aliceAuthId, "alice"));

    await expect(pending).resolves.toBeNull();
  });

  it("revokes a stale login with its captured Session token without signing out a newer same-account Session", async () => {
    const staleSessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const nextSessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const staleAccessToken = tokenForSession(aliceAuthId, staleSessionId);
    mocks.client.functions.invoke.mockResolvedValue({
      data: {
        success: true,
        data: {
          session: session(aliceAuthId, "alice"),
          tokens: {
            accessToken: staleAccessToken,
            refreshToken: "stale-refresh",
            expiresAt: 1_900_000_000
          }
        }
      },
      error: null
    });
    mocks.client.auth.setSession.mockResolvedValue({
      data: { session: supabaseAuthSession(aliceAuthId, staleSessionId) },
      error: null
    });
    mocks.client.auth.getSession.mockResolvedValue({
      data: { session: supabaseAuthSession(aliceAuthId, nextSessionId) },
      error: null
    });
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response("true", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loginWithSupabase({ loginName: "alice", password: "secret" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    await result.discardIfStale();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/rest/v1/rpc/revoke_account_password_session", "http://127.0.0.1:54321"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${staleAccessToken}` })
      })
    );
    expect(mocks.client.auth.signOut).not.toHaveBeenCalled();
  });

  it("does not reuse a delayed profile when the same account has a new Auth Session", async () => {
    const nextSessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mocks.client.auth.getSession
      .mockResolvedValueOnce({
        data: { session: supabaseAuthSession(aliceAuthId, aliceSessionId) },
        error: null
      })
      .mockResolvedValueOnce({
        data: { session: supabaseAuthSession(aliceAuthId, nextSessionId) },
        error: null
      });

    let resolveProfile!: (value: ReturnType<typeof session>) => void;
    mocks.getCurrentSession.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    const pending = restoreSupabaseSession({ authUserId: aliceAuthId, sessionId: aliceSessionId });
    await Promise.resolve();
    resolveProfile(session(aliceAuthId, "alice"));

    await expect(pending).resolves.toBeNull();
  });

  it("clears a rejected persisted Auth Session only when its session_id is still current", async () => {
    const nextSessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mocks.client.auth.getSession
      .mockResolvedValueOnce({
        data: { session: supabaseAuthSession(aliceAuthId, nextSessionId) },
        error: null
      })
      .mockResolvedValueOnce({
        data: { session: supabaseAuthSession(aliceAuthId, aliceSessionId) },
        error: null
      });

    await expect(
      clearRejectedSupabaseSessionIfCurrent({
        authUserId: aliceAuthId,
        sessionId: aliceSessionId
      })
    ).resolves.toBe(false);
    expect(mocks.client.auth.signOut).not.toHaveBeenCalled();

    await expect(
      clearRejectedSupabaseSessionIfCurrent({
        authUserId: aliceAuthId,
        sessionId: aliceSessionId
      })
    ).resolves.toBe(true);
    expect(mocks.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("restores only a recovery Auth callback and keeps token parsing in the auth service", async () => {
    const accessToken = accessTokenWithAmr("recovery");
    mocks.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.client.auth.setSession.mockResolvedValue({
      data: { session: { access_token: accessToken } },
      error: null
    });
    const hash = `#/reset-password#type=recovery&token_type=bearer&access_token=${accessToken}&refresh_token=recovery-refresh`;

    await expect(restorePasswordRecoverySession(hash)).resolves.toEqual({
      available: true,
      scrubCallback: true
    });
    expect(mocks.client.auth.setSession).toHaveBeenCalledWith({
      access_token: accessToken,
      refresh_token: "recovery-refresh"
    });
  });

  it("does not turn a normal password Auth Session into a recovery session", async () => {
    mocks.client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: accessTokenWithAmr("password") } },
      error: null
    });

    await expect(restorePasswordRecoverySession("#/reset-password")).resolves.toEqual({
      available: false,
      scrubCallback: false
    });
    expect(mocks.client.auth.setSession).not.toHaveBeenCalled();
  });
});
