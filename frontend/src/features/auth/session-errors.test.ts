import { AuthApiError, AuthError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  AuthSessionRejectedError,
  isAuthSessionRejectedError,
  isExplicitAuthRejection,
  isTransientAuthSessionError
} from "./session-errors";

describe("Auth session error classification", () => {
  it("preserves the current UI identity for fetch, no-response, and server failures", () => {
    expect(isTransientAuthSessionError(new AuthRetryableFetchError("network", 503))).toBe(true);
    expect(isTransientAuthSessionError(new AuthError("no response"))).toBe(true);
    expect(
      isTransientAuthSessionError(new AuthApiError("service unavailable", 503, "server_error"))
    ).toBe(true);
    expect(isTransientAuthSessionError({ code: "PGRST000" })).toBe(true);
    expect(isTransientAuthSessionError({ code: "PGRST003" })).toBe(true);
    expect(isTransientAuthSessionError({ status: 503 })).toBe(true);
  });

  it("does not preserve a session rejected by Auth", () => {
    expect(
      isTransientAuthSessionError(
        new AuthApiError("refresh token is invalid", 400, "invalid_grant")
      )
    ).toBe(false);
    expect(
      isTransientAuthSessionError(new AuthApiError("session is invalid", 401, "unauthorized"))
    ).toBe(false);
    expect(isTransientAuthSessionError({ code: "PGRST301" })).toBe(false);
    expect(isTransientAuthSessionError({ code: "PGRST202" })).toBe(false);
  });

  it("classifies an explicit profile Auth denial while preserving transient and database failures", () => {
    expect(isExplicitAuthRejection({ code: "PGRST301" })).toBe(true);
    expect(isExplicitAuthRejection({ code: "PGRST302" })).toBe(true);
    expect(isExplicitAuthRejection({ code: "PGRST303" })).toBe(true);
    expect(isExplicitAuthRejection({ status: 401 })).toBe(true);
    expect(isExplicitAuthRejection({ code: "", message: "Unauthorized" }, 401)).toBe(true);
    expect(isExplicitAuthRejection({ code: "PGRST000", status: 503 })).toBe(false);
    expect(isExplicitAuthRejection({ code: "42501" })).toBe(false);
    expect(isAuthSessionRejectedError(new AuthSessionRejectedError("rejected"))).toBe(true);
  });
});
