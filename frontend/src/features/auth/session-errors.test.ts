import { AuthApiError, AuthError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { isTransientAuthSessionError } from "./session-errors";

describe("Auth session error classification", () => {
  it("preserves the current UI identity for fetch, no-response, and server failures", () => {
    expect(isTransientAuthSessionError(new AuthRetryableFetchError("network", 503))).toBe(true);
    expect(isTransientAuthSessionError(new AuthError("no response"))).toBe(true);
    expect(isTransientAuthSessionError(new AuthApiError("service unavailable", 503, "server_error"))).toBe(true);
  });

  it("does not preserve a session rejected by Auth", () => {
    expect(isTransientAuthSessionError(new AuthApiError("refresh token is invalid", 400, "invalid_grant"))).toBe(false);
    expect(isTransientAuthSessionError(new AuthApiError("session is invalid", 401, "unauthorized"))).toBe(false);
  });
});
