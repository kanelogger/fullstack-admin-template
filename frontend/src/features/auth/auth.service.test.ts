import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/shared/supabase/client", () => ({
  getSupabaseClient: () => mocks.client
}));
vi.mock("@/features/profile/profile.service", () => ({
  getCurrentSession: mocks.getCurrentSession
}));

import { loginWithSupabase, restoreSupabaseSession } from "./auth.service";
import { invalidateAuthOperations } from "./session-generation";

const aliceAuthId = "11111111-1111-4111-8111-111111111111";
const bobAuthId = "22222222-2222-4222-8222-222222222222";

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

function supabaseAuthSession(authUserId: string) {
  return {
    access_token: `access-${authUserId}`,
    refresh_token: `refresh-${authUserId}`,
    user: { id: authUserId }
  };
}

describe("Supabase Auth application session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAuthOperations();
  });

  it("logs in with account and password and keeps Supabase as the only session", async () => {
    mocks.client.functions.invoke.mockResolvedValue({
      data: {
        success: true,
        data: {
          session: session(aliceAuthId, "alice"),
          tokens: {
            accessToken: `access-${aliceAuthId}`,
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
      access_token: `access-${aliceAuthId}`,
      refresh_token: `refresh-${aliceAuthId}`
    });
    expect(result).toEqual({ success: true, data: session(aliceAuthId, "alice") });
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it("does not restore a delayed profile after logout or account switch", async () => {
    mocks.client.auth.getSession
      .mockResolvedValueOnce({ data: { session: supabaseAuthSession(aliceAuthId) }, error: null })
      .mockResolvedValueOnce({ data: { session: supabaseAuthSession(bobAuthId) }, error: null });

    let resolveProfile!: (value: ReturnType<typeof session>) => void;
    mocks.getCurrentSession.mockReturnValue(new Promise(resolve => {
      resolveProfile = resolve;
    }));

    const pending = restoreSupabaseSession();
    await Promise.resolve();
    invalidateAuthOperations();
    resolveProfile(session(aliceAuthId, "alice"));

    await expect(pending).resolves.toBeNull();
  });
});
