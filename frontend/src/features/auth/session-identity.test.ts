import { describe, expect, it } from "vitest";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { getAuthSessionIdentity, isSameAuthSession } from "./session-identity";

function tokenForClaims(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

function session(accessToken: string, userId: string): SupabaseSession {
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "refresh",
    user: { id: userId }
  } as unknown as SupabaseSession;
}

describe("Auth session identity", () => {
  it("reads a UUID session_id only when the JWT subject matches the Auth user", () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const authSession = session(tokenForClaims({ sub: userId, session_id: sessionId }), userId);
    expect(getAuthSessionIdentity(authSession)).toEqual({
      authUserId: userId,
      sessionId,
      accessToken: authSession.access_token
    });
    expect(getAuthSessionIdentity(session(tokenForClaims({ sub: "different", session_id: sessionId }), userId))).toBeNull();
  });

  it("rejects missing and malformed session_id claims", () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(getAuthSessionIdentity(session(tokenForClaims({ sub: userId }), userId))).toBeNull();
    expect(getAuthSessionIdentity(session(tokenForClaims({ sub: userId, session_id: "not-a-uuid" }), userId))).toBeNull();
    expect(getAuthSessionIdentity(session("malformed", userId))).toBeNull();
  });

  it("treats the same user in a newly created Session as a different identity", () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const firstSession = { authUserId: userId, sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const nextSession = { authUserId: userId, sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    expect(isSameAuthSession(firstSession, firstSession)).toBe(true);
    expect(isSameAuthSession(firstSession, nextSession)).toBe(false);
  });
});
